import React, { useState, useEffect, useRef } from "react";
import PropertyFrontView from "@/components/PropertyFrontView";
import { createCrewPhotoArchive } from "@/utils/crewPhotoArchive";
import { syncPhotoSyncClientNames } from "@/utils/photoSyncCustomerName";
import { base44 } from "@/api/base44Client";
import { generateMaterialList } from "@/lib/functions";
import MissingPurchaseMaterials from "@/components/estimates/MissingPurchaseMaterials";
import MaterialPurchaseRow from "@/components/estimates/MaterialPurchaseRow";
import { BulkDeleteButton } from "@/components/BulkDeleteControls";
import useRoleBasedData from "@/components/hooks/useRoleBasedData";
import CallerMemoryCard from "@/components/ai/CallerMemoryCard";
import { setViewingContact } from "@/utils/viewingContact";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  User,
  Building,
  Phone,
  Mail,
  MapPin,
  FileText,
  DollarSign,
  CreditCard,
  Briefcase,
  CheckSquare,
  CheckCircle2,
  Clock,
  UserPlus,
  MessageSquare,
  Calendar,
  FileSignature,
  Folder,
  Bell,
  Receipt,
  Save,
  ArrowLeft,
  Plus,
  Loader2,
  Upload,
  Eye,
  Trash2,
  Image,
  Download,
  Pencil,
  MoreVertical,
  CheckCircle,
  Camera,
  X,
  Wrench,
  Send,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronDown,
  RotateCcw,
  Minus,
  Maximize2,
  Star,
  UserX,
  UserCheck,
  ShoppingCart,
  ClipboardList,
  Palette,
  Copy,
  AlertTriangle
} from "lucide-react";
import { format } from "date-fns";
import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl, validateE164Phone } from "@/utils";
import { isChangeOrder } from "@/lib/changeOrders";
import ChangeOrderBadge from "@/components/estimates/ChangeOrderBadge";
import Dialer from "../components/communication/Dialer";
import EmailDialog from "../components/communication/EmailDialog";
import SMSDialog from "../components/communication/SMSDialog";
import CommissionSummary from "../components/customer/CommissionSummary";
import CrewPhotoSharing, { useCrewPhotoSharing } from "../components/customer/CrewPhotoSharing";
import CustomerGroupSelect from "../components/customers/CustomerGroupSelect";
import CustomerTagSelect from "../components/customers/CustomerTagSelect";
import InstallerSelect from "../components/customers/InstallerSelect";
import VendorSelect from "../components/customers/VendorSelect";
import MaterialColorSelect from "../components/customers/MaterialColorSelect";
import MaterialBrandSelect from "../components/customers/MaterialBrandSelect";
import AssignmentDialog from "../components/inspections/AssignmentDialog";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SiWhatsapp } from "react-icons/si";
import ColorVisualizerPanel from "../components/visualizer/ColorVisualizerPanel";
import { HIDDEN_FEATURES } from "@/config/hiddenFeatures";
import { localToday } from "@/utils/localDate";
import { parsePaymentDate, paymentDateInput } from "@/utils/paymentDates";
import { cacheSavedCustomer, shouldRefreshCustomerDraft } from "@/utils/customerSaveState";
import { getInvoicesForCustomerId } from "@/utils/invoiceCustomerAssociation";
import {
  findUnknownInvoiceIds,
  findForeignInvoiceIds,
  rejectForeignPayments,
  selectPaymentsToRelink,
  pickInvoiceForPayment,
  makeInvoiceMatcher,
  getPaymentPayerDetails,
  paymentPayerDiffersFromCustomer,
} from "@/utils/paymentOwnership";
import { reverseStandaloneDeduction } from "@/utils/standaloneDeduction";
import {
  normalizeName,
  collectNameCandidates,
  classifyNameCandidates,
  contactTargetQuery,
} from "@/utils/contactResolution";

export default function CustomerProfile() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(location.search);
  const customerNameFromUrl = urlParams.get('name');
  // Estimates/proposals send the name they stored plus, when they have one, the
  // lead they were created against. The lead is only a hint: it is used if the
  // name matches nobody, because converting a lead leaves a dead lead_id behind.
  const leadIdHintFromUrl = urlParams.get('lead_id');

  const [customerId, setCustomerId] = useState(null);
  const [activeSection, setActiveSection] = useState("profile");
  const [deactivateConfirmOpen, setDeactivateConfirmOpen] = useState(false);
  const [showDialer, setShowDialer] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showSMSDialog, setShowSMSDialog] = useState(false);
  const [showLogCallDialog, setShowLogCallDialog] = useState(false);
  const [logCallForm, setLogCallForm] = useState({ direction: 'inbound', duration_minutes: '', notes: '', call_date: localToday() });
  const [isLoggingCall, setIsLoggingCall] = useState(false);
  const [isHandingBackSarah, setIsHandingBackSarah] = useState(false);
  const [customerData, setCustomerDataState] = useState(null);
  const customerDraft = useRef({ id: null, dirty: false });
  const setCustomerData = (value) => {
    customerDraft.current.dirty = true;
    setCustomerDataState(value);
  };
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showPortalDialog, setShowPortalDialog] = useState(false);
  const [sendingPortalLink, setSendingPortalLink] = useState(null);
  const [confirmPortalSend, setConfirmPortalSend] = useState(null);
  const [showCommissionSplitPrompt, setShowCommissionSplitPrompt] = useState(false);
  const [pendingSaveArgs, setPendingSaveArgs] = useState(null);
  const [suggestedSplitStaff, setSuggestedSplitStaff] = useState([]);
  const [showAddPaymentMethod, setShowAddPaymentMethod] = useState(false);
  const [newPaymentMethodName, setNewPaymentMethodName] = useState("");
  const [customPaymentMethods, setCustomPaymentMethods] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('custom_payment_methods') || '[]');
    } catch { return []; }
  });
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    payment_method: "cash",
    payment_date: localToday(),
    payer_name: "",
    payer_email: "",
    invoice_number: "",
    reference_number: "",
    notes: "",
    send_receipt: true
  });

  const [showEditPaymentDialog, setShowEditPaymentDialog] = useState(false);
  const [editPaymentForm, setEditPaymentForm] = useState({
    id: null,
    amount: "",
    payment_method: "cash",
    payment_date: localToday(),
    payer_name: "",
    payer_email: "",
    invoice_number: "",
    reference_number: "",
    notes: ""
  });

  const [selectedEstimateIds, setSelectedEstimateIds] = useState(new Set());
  const [isDeletingEstimates, setIsDeletingEstimates] = useState(false);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [resendingSessionId, setResendingSessionId] = useState(null);
  const [fileForm, setFileForm] = useState({
    label: "",
    category: "",
    notes: "",
    files: []
  });
  const [customCategories, setCustomCategories] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [imageErrors, setImageErrors] = useState({});
  const [viewingFile, setViewingFile] = useState(null);
  const [fileZoom, setFileZoom] = useState(1);

  const [editingFile, setEditingFile] = useState(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editForm, setEditForm] = useState({
    document_name: "",
    category: "",
    description: ""
  });

  const { user, myCompany, isAdmin, hasPermission, isPermissionsReady, effectiveUserEmail } = useRoleBasedData();
  const [selectedFiles, setSelectedFiles] = useState([]); // New state for selected files for PDF
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false); // New state for PDF generation loading
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [isNewInspectionOpen, setIsNewInspectionOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({
    name: "",
    description: "",
    priority: "medium",
    due_date: "",
    assigned_to: "",
    status: "not_started"
  });
  const [showCheckUploadDialog, setShowCheckUploadDialog] = useState(false);
  const [isProcessingCheck, setIsProcessingCheck] = useState(false);
  const [checkInvoiceId, setCheckInvoiceId] = useState("");
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editedNoteText, setEditedNoteText] = useState('');
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [bulkDeleteNotes, setBulkDeleteNotes] = useState('');
  const [phoneErrors, setPhoneErrors] = useState({ phone: null, phone_2: null, adjuster_phone: null });
  const [viewingCrewPhoto, setViewingCrewPhoto] = useState(null);
  const [viewingMaterialList, setViewingMaterialList] = useState(null);
  const [refreshingMaterialList, setRefreshingMaterialList] = useState(false);
  const refreshViewedMaterialList = async () => {
    if (!viewingMaterialList?.estimate_id || !myCompany?.id || !customer?.id) {
      toast.error('This saved list has no linked estimate. Open the estimate and generate a new material list.');
      return;
    }
    const listId = viewingMaterialList.id;
    setRefreshingMaterialList(true);
    try {
      const matches = await base44.entities.Estimate.filter({ id: viewingMaterialList.estimate_id, company_id: myCompany.id });
      const source = matches?.[0];
      if (!source || String(source.company_id) !== String(myCompany.id) || String(source.customer_id) !== String(customer.id)) throw new Error('The linked estimate could not be verified for this customer.');
      const generated = await generateMaterialList({ estimate: source, jobType: source.job_type, trade: source.trade, category: source.category });
      if (!generated?.success) throw new Error(generated?.error || 'Material list generation failed.');
      const update = {
        materials: generated.materials, labor: generated.labor, other: generated.other,
        material_calculations: generated.material_calculations, missing_materials: generated.missing_materials,
        totals: generated.totals, scope: generated.scope, pricing_incomplete: generated.pricing_incomplete, generated_at: new Date().toISOString(),
      };
      await base44.entities.MaterialList.update(listId, update);
      setViewingMaterialList(prev => prev?.id === listId ? { ...prev, ...update } : prev);
      queryClient.invalidateQueries({ queryKey: ['customer-material-lists', customer.id, myCompany.id] });
      toast.success('Material list refreshed from the current estimate.');
    } catch (error) {
      toast.error(error.message || 'Could not refresh material list.');
    } finally {
      setRefreshingMaterialList(false);
    }
  };
  const [mlViewTab, setMlViewTab] = useState('order');
  const [crewPhotoFilter, setCrewPhotoFilter] = useState('all');
  const [isDownloadingCrewPhotos, setIsDownloadingCrewPhotos] = useState(false);
  const [crewPhotoDownloadProgress, setCrewPhotoDownloadProgress] = useState({ completed: 0, total: 0 });
  const [sendPhotosOpen, setSendPhotosOpen] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState(new Set());
  const [sendPhotosMsg, setSendPhotosMsg] = useState('');
  const [showSendForSignatureDialog, setShowSendForSignatureDialog] = useState(false);
  const [signatureSelectedTemplate, setSignatureSelectedTemplate] = useState(null);
  const [signatureContractForm, setSignatureContractForm] = useState({ contract_name: "", delivery_method: "email" });

  const { data: customer, isLoading: isLoadingCustomers } = useQuery({
    queryKey: ['customer', customerId, customerNameFromUrl],
    queryFn: async () => {
      if (!customerId) return null;
      // A name is not an identity, so never resolve one here. Two customers
      // routinely share a name, the spelling may differ only by case, and the
      // name may belong to a lead rather than a customer. Opening the wrong
      // file means the wrong invoices, payments and history. The candidate
      // query below gathers everyone with that name and only opens a record
      // when exactly one exists.
      if (customerNameFromUrl && customerId === customerNameFromUrl) {
        return null;
      }
      // Standard lookup by ID
      try {
        const result = await base44.entities.Customer.get(customerId);
        if (result) return result;
      } catch (e) {}
      return null;
    },
    enabled: !!customerId,
    staleTime: 60000,
    retry: 1,
  });

  // Nothing resolved above. Estimates, proposals and old bookmarks all link
  // here, but their subject is often still a Lead, or one of several records
  // sharing a name. Collect every candidate instead of guessing: one hit is
  // forwarded, several are shown as a choice, none is an honest "not found".
  const { data: nameCandidates, isLoading: isLoadingNameCandidates } = useQuery({
    queryKey: ['customer-profile-name-candidates', customerId, customerNameFromUrl],
    queryFn: async () => {
      if (!customerId) return [];

      // An `?id=` link that found no customer may have carried a lead id.
      // Only ever try this for a real id — a *name* that happens to equal some
      // unrelated lead's id must never open that lead.
      if (!customerNameFromUrl) {
        try {
          const byId = await base44.entities.Lead.filter({ id: customerId });
          if (byId && byId.length > 0) {
            return [{ id: byId[0].id, name: byId[0].name, kind: 'lead' }];
          }
        } catch (e) {}
        return [];
      }

      if (!normalizeName(customerId)) return [];
      // $contains is a loose ILIKE so it catches case and spacing differences;
      // collectNameCandidates then keeps only true matches.
      let customerRows = [];
      let leadRows = [];
      try {
        customerRows = await base44.entities.Customer.filter({ name: { $contains: customerId } });
      } catch (e) {}
      try {
        leadRows = await base44.entities.Lead.filter({ name: { $contains: customerId } });
      } catch (e) {}
      return collectNameCandidates(customerId, [
        { kind: 'customer', rows: customerRows },
        { kind: 'lead', rows: leadRows },
      ]);
    },
    enabled: !!customerId && !isLoadingCustomers && !customer,
    staleTime: 60000,
  });

  useEffect(() => {
    if (!customer?.id || !myCompany?.id) return;
    setViewingContact({
      phone: customer.phone || customer.phone_2 || '',
      customerId: customer.id,
      name: customer.name || '',
      companyId: myCompany.id,
    });
  }, [customer?.id, customer?.phone, customer?.phone_2, customer?.name, myCompany?.id]);

  const candidateVerdict = nameCandidates ? classifyNameCandidates(nameCandidates) : null;
  let candidateTarget = candidateVerdict?.action === 'open' ? candidateVerdict.target : null;
  // Nobody carries that name any more, but the record pointed at a lead — that
  // explicit pointer is not a guess, so follow it rather than dead-ending.
  if (!candidateTarget && candidateVerdict?.action === 'none' && leadIdHintFromUrl) {
    candidateTarget = { page: 'LeadProfile', params: { id: leadIdHintFromUrl } };
  }
  const candidateTargetUrl = candidateTarget
    ? createPageUrl(candidateTarget.page) + contactTargetQuery(candidateTarget)
    : null;

  useEffect(() => {
    if (candidateTargetUrl) navigate(candidateTargetUrl, { replace: true });
  }, [candidateTargetUrl, navigate]);

  const { data: contractTemplates = [] } = useQuery({
    queryKey: ['contract-templates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.ContractTemplate.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const sendPhotosMutation = useMutation({
    mutationFn: async ({ photoIds, message }) => {
      if (!customer?.email) throw new Error('Customer has no email on file');
      const photos = crewPhotos.filter(p => photoIds.has(p.id));
      if (!photos.length) throw new Error('No photos selected');
      const baseUrl = window.location.origin;
      const photoLinksHtml = photos.map((p, idx) => {
        const url = (p.file_url || p.url || '');
        const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
        return `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;">
          <a href="${fullUrl}" target="_blank" style="color:#ea580c;font-weight:500;text-decoration:none;">
            📷 Photo ${idx + 1}${p.caption ? ` — ${p.caption}` : ''}
          </a>
          ${p.created_at ? `<span style="color:#9ca3af;font-size:12px;margin-left:8px;">${new Date(p.created_at).toLocaleDateString()}</span>` : ''}
        </td></tr>`;
      }).join('');
      const companyName = myCompany?.company_name || 'Your Contractor';
      const subject = `Job Site Photos from ${companyName}`;
      const html = `<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#ea580c 0%,#c2410c 100%);padding:20px 24px;border-radius:10px 10px 0 0;">
          <h1 style="color:white;margin:0;font-size:22px;">📸 Job Site Photos</h1>
          <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:14px;">${companyName}</p>
        </div>
        <div style="background:#f9fafb;padding:24px;border-radius:0 0 10px 10px;">
          <p style="margin:0 0 16px;">Hello <strong>${customer.name}</strong>,</p>
          ${message ? `<p style="background:#fff;border-left:4px solid #ea580c;padding:12px 16px;border-radius:0 6px 6px 0;margin:0 0 16px;">${message}</p>` : '<p style="margin:0 0 16px;">Here are the job site photos from your project:</p>'}
          <table style="width:100%;border-collapse:collapse;">${photoLinksHtml}</table>
          <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">Click each link to view the full-size photo. — ${companyName}</p>
        </div>
      </div>`;
      await base44.functions.invoke('sendEmailWithBranding', {
        to: customer.email,
        companyId: customer.company_id,
        subject,
        html,
        manualSend: true,
      });
    },
    onSuccess: () => {
      setSendPhotosOpen(false);
      setSelectedPhotoIds(new Set());
      setSendPhotosMsg('');
      toast.success(`Photos sent to ${customer?.name}!`);
    },
    onError: (err) => toast.error('Failed to send photos: ' + (err.message || 'Unknown error')),
  });

  const downloadAllCrewPhotos = async () => {
    if (isDownloadingCrewPhotos || crewPhotos.length === 0) return;
    setIsDownloadingCrewPhotos(true);
    setCrewPhotoDownloadProgress({ completed: 0, total: crewPhotos.length });
    try {
      const zipBlob = await createCrewPhotoArchive(crewPhotos, {
        onProgress: (progress) => setCrewPhotoDownloadProgress(progress),
      });
      const customerSlug = String(customer?.name || 'customer')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'customer';
      const dateStamp = new Date().toISOString().slice(0, 10);
      const url = window.URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${customerSlug}-crew-photos-${dateStamp}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
      toast.success(`Downloaded all ${crewPhotos.length} photos. Attach the Certificate of Completion separately.`);
    } catch (error) {
      toast.error(error.message || 'Could not download the complete photo set.');
    } finally {
      setIsDownloadingCrewPhotos(false);
      setCrewPhotoDownloadProgress({ completed: 0, total: 0 });
    }
  };

  const deleteCrewPhotoMutation = useMutation({
    mutationFn: async (photoId) => {
      await base44.entities.JobMedia.delete(photoId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-crew-photos', customer?.id] });
      toast.success('Photo deleted');
    },
    onError: (err) => toast.error('Failed to delete photo: ' + (err.message || 'Unknown error')),
  });

  const highlightCrewPhotoMutation = useMutation({
    mutationFn: async ({ photoId, highlighted }) => {
      await base44.entities.JobMedia.update(photoId, { is_highlighted: highlighted });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-crew-photos', customer?.id] });
    },
    onError: (err) => toast.error('Failed to update photo: ' + (err.message || 'Unknown error')),
  });

  const createSigningSessionMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.entities.ContractSigningSession.create({
        company_id: myCompany?.id,
        template_id: data.template.id,
        template_name: data.template.template_name,
        contract_name: data.contract_name,
        customer_name: customer.name,
        customer_email: customer.email || '',
        customer_phone: customer.phone || '',
        customer_id: customer.id,
        delivery_method: data.delivery_method,
        rep_name: user?.full_name,
        rep_email: user?.email,
        status: 'draft',
        current_signer: 'rep'
      });
    },
    onSuccess: (newSession) => {
      setShowSendForSignatureDialog(false);
      setSignatureSelectedTemplate(null);
      setSignatureContractForm({ contract_name: "", delivery_method: "email" });
      queryClient.invalidateQueries({ queryKey: ['customer-signing-sessions', customer?.id, myCompany?.id] });
      if (newSession?.id) {
        toast.success('Contract created — fill in your details and sign, then it will be sent to the customer.');
        navigate(createPageUrl('SignContractRep') + '?sessionId=' + newSession.id);
      } else {
        setActiveSection('contracts');
        toast.success('Contract created. It now appears in Signing History — open it to sign and send.');
      }
    },
    onError: (error) => {
      toast.error('Failed to start signing: ' + error.message);
    }
  });

  const copyCrewUploadLink = React.useCallback(async () => {
    try {
      let tok = customer?.portal_token;
      if (!tok) {
        tok = window.crypto.randomUUID();
        await base44.entities.Customer.update(customer.id, { portal_token: tok });
        queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });
      }
      const uploadUrl = `${window.location.origin}/crew-upload?token=${encodeURIComponent(tok)}&cid=${encodeURIComponent(customer.id)}`;
      await navigator.clipboard.writeText(uploadUrl);
      toast.success('📸 Crew upload link copied! Paste it in WhatsApp for your crew.');
    } catch (err) {
      toast.error('Failed to copy crew upload link: ' + err.message);
    }
  }, [customer, queryClient]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    const name = urlParams.get('name');
    
    if (id) {
      setCustomerId(id);
    } else if (name) {
      setCustomerId(name);
    }
  }, [location.search]);

  useEffect(() => {
    if (!customerId) return;
    const VALID_CREW_PHOTO_FILTERS = ['all', 'whatsapp_upload', 'crew_upload'];
    const stored = localStorage.getItem(`crewPhotoFilter_${customerId}`);
    setCrewPhotoFilter(VALID_CREW_PHOTO_FILTERS.includes(stored) ? stored : 'all');
  }, [customerId]);

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['company-staff-all', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
  });

  const allCompanyStaff = staffProfiles;

  useEffect(() => {
    if (customer && shouldRefreshCustomerDraft(customerDraft.current, customer.id)) {
      customerDraft.current = { id: customer.id, dirty: false };
      setCustomerDataState({
        ...customer,
        street: customer.street || "",
        city: customer.city || "",
        state: customer.state || "",
        zip: customer.zip || "",
        assigned_to_users: customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []),
        notes: customer.notes || "",
        company: customer.company || "",
        phone: customer.phone || "",
        phone_2: customer.phone_2 || "",
        email: customer.email || "",
        groups: customer.groups || (customer.group ? [customer.group] : []),
        group: customer.group || "",
        insurance_company: customer.insurance_company || "",
        claim_number: customer.claim_number || "",
        adjuster_name: customer.adjuster_name || "",
        adjuster_phone: customer.adjuster_phone || "",
        installers: customer.installers
          ? customer.installers
          : customer.installer
            ? [customer.installer]
            : [],
        vendor_names: customer.vendor_names
          ? customer.vendor_names
          : customer.vendor_name
            ? [customer.vendor_name]
            : [],
        material_colors: customer.material_colors
          ? customer.material_colors
          : customer.material_color
            ? [customer.material_color]
            : [],
        material_brands: customer.material_brands
          ? customer.material_brands
          : customer.material_brand
            ? [customer.material_brand]
            : [],
        tags: customer.tags || [],
        commission_splits: customer.commission_splits || [],
      });
    }
  }, [customer]);

  useEffect(() => {
    if (myCompany?.id) {
      const savedCategories = localStorage.getItem(`custom_categories_${myCompany.id}`);
      if (savedCategories) {
        setCustomCategories(JSON.parse(savedCategories));
      }
    }
  }, [myCompany]);

  // 🔐 Access guard: check if user can view this specific customer
  const canAccessCustomer = React.useMemo(() => {
    if (!isPermissionsReady || !customer || !effectiveUserEmail) return true; // allow while loading
    if (isAdmin) return true;
    return (
      customer.assigned_to === effectiveUserEmail ||
      customer.assigned_to_users?.includes(effectiveUserEmail) ||
      customer.created_by === effectiveUserEmail
    );
  }, [customer, isAdmin, isPermissionsReady, effectiveUserEmail]);

  const { data: estimates = [] } = useQuery({
      queryKey: ['customer-estimates', customer?.id, customer?.name, customer?.email, myCompany?.id],
      queryFn: async () => {
        if (!customer || !myCompany) return [];

        const cid = myCompany.id;

        const byId = await base44.entities.Estimate.filter({ customer_id: customer.id, company_id: cid });

        const byName = await base44.entities.Estimate.filter({ customer_name: customer.name, company_id: cid });
        const byEmail = customer.email ? await base44.entities.Estimate.filter({ customer_email: customer.email, company_id: cid }) : [];

        // An estimate that already has a customer_id pointing to a DIFFERENT customer must
        // never bleed onto this profile just because the name or email happened to match.
        // Only accept name/email hits that are unlinked (no customer_id) or already linked
        // to THIS customer.
        const isOwnedOrUnlinked = (e) => !e.customer_id || e.customer_id === customer.id;

        const normalize = (s) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
        const targetName = normalize(customer.name);
        // Only do the broad company scan if we have a non-empty name/email to match against.
        // An empty targetName would match every estimate with no customer_name set (both normalise to '').
        let ciMatches = [];
        if (targetName || customer.email) {
          const recent = await base44.entities.Estimate.filter({ company_id: cid }, '-created_date', 200);
          ciMatches = recent.filter((e) =>
            isOwnedOrUnlinked(e) && (
              (targetName && normalize(e.customer_name) === targetName) ||
              (customer.email && (e.customer_email || '').toLowerCase() === customer.email.toLowerCase())
            )
          );
        }

        const allEstimates = [
          ...byId,
          ...byName.filter(isOwnedOrUnlinked),
          ...(byEmail || []).filter(isOwnedOrUnlinked),
          ...ciMatches,
        ];
        const uniqueEstimates = allEstimates.filter((est, idx, self) => idx === self.findIndex((e) => e.id === est.id));
        return uniqueEstimates;
      },
      enabled: !!customer && !!myCompany,
    });

  const { data: invoices = [] } = useQuery({
    queryKey: ['customer-invoices', customer?.id, myCompany?.id],
    queryFn: async () => {
      if (!customer?.id || !myCompany?.id) return [];
      const linked = await base44.entities.Invoice.filter({ customer_id: customer.id, company_id: myCompany.id });
      return getInvoicesForCustomerId(linked, customer.id);
    },
    enabled: !!customer && !!myCompany,
  });

  const outstandingInvoicesForCheck = React.useMemo(() => (
    invoices.filter((inv) => {
      const total = Number(inv.total_amount ?? inv.amount ?? 0);
      const paid = Number(inv.amount_paid || 0);
      return ['sent', 'draft', 'viewed', 'overdue', 'partially_paid'].includes(inv.status)
        && total > paid;
    })
  ), [invoices]);

  const { data: payments = [] } = useQuery({
    queryKey: ['customer-payments', customer?.id, myCompany?.id],
    queryFn: async () => {
      if (!customer || !myCompany) return [];
      const cid = myCompany.id;
      const byId = await base44.entities.Payment.filter({ customer_id: customer.id, company_id: cid });
      const byName = await base44.entities.Payment.filter({ customer_name: customer.name, company_id: cid });
      let byInvoices = [];
      if (invoices && invoices.length > 0) {
        const results = await Promise.all(
          invoices.map(inv => base44.entities.Payment.filter({ invoice_number: inv.invoice_number, company_id: cid }))
        );
        // A payment found via this customer's own invoice numbers usually belongs to this
        // customer even if customer_id / customer_name were recorded with a different
        // spelling (e.g. "Patricia" vs "Patricia hallick") — but invoice_number is NOT
        // unique, so this set still has to be vetted below.
        byInvoices = results.flat();
      }
      const merged = [...byId, ...byName, ...byInvoices];
      const unique = merged.filter((p, idx, self) => idx === self.findIndex(x => x.id === p.id));

      // invoice_number is only as unique as whoever typed it — historically two
      // customers have ended up sharing one (e.g. two different invoices both
      // numbered INV-2026-0385). invoice_id IS unique, and it points at the invoice
      // whose balance this payment actually moved, so let it settle ownership.
      // Only exclude a payment when we can POSITIVELY confirm its invoice belongs to
      // someone else — never merely because we couldn't find the invoice.
      const myInvoiceIds = new Set((invoices || []).map(i => i.id));
      const unknownInvoiceIds = findUnknownInvoiceIds(unique, myInvoiceIds);
      if (unknownInvoiceIds.length === 0) return unique;

      const looked = await Promise.all(unknownInvoiceIds.map(async (id) => {
        try {
          const [inv] = await base44.entities.Invoice.filter({ id, company_id: cid });
          return inv || null;
        } catch { return null; }
      }));
      const foreignInvoiceIds = findForeignInvoiceIds(looked, {
        customerId: customer.id,
        customerName: customer.name,
      });
      return rejectForeignPayments(unique, foreignInvoiceIds);
    },
    enabled: !!customer && !!myCompany,
  });
  const paymentSourceWarnings = React.useMemo(
    () => payments.filter(payment => paymentPayerDiffersFromCustomer(payment, customer)),
    [payments, customer]
  );

  // Auto-link orphan payments (missing customer_id) to this customer when invoice/customer match
  const reconcileRun = useRef(false);
  useEffect(() => {
    const run = async () => {
      if (!customer || reconcileRun.current || payments.length === 0) return;
      // Re-link ONLY when we are sure. Matching on invoice_number here is what let a
      // payment get re-stamped onto the wrong customer: invoice numbers are not
      // unique, so two customers sharing a number took turns claiming each other's
      // payments every time someone opened their profile.
      const toFix = selectPaymentsToRelink(payments, {
        customerId: customer.id,
        customerName: customer.name,
        myInvoiceIds: (invoices || []).map(i => i.id),
      });
      if (toFix.length === 0) { reconcileRun.current = true; return; }
      for (const p of toFix) {
        try {
          await base44.entities.Payment.update(p.id, { customer_id: customer.id, customer_name: customer.name });
        } catch (e) { console.warn('Payment link fix failed', p.id, e?.message); }
      }
      reconcileRun.current = true;
      queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id, payments.length, invoices.length]);

  const { data: allPayouts = [] } = useQuery({
    queryKey: ['all-payouts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payout.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
  });

  const payouts = React.useMemo(() => {
    if (!customer) return [];
    // Only include payouts explicitly recorded for this customer.
    // Do NOT pull in all payouts for a rep just because they appear on one of this
    // customer's invoices — that would include their commissions from other customers too.
    return allPayouts.filter(p => p.customer_id === customer.id);
  }, [customer, allPayouts]);

  const { data: projects = [] } = useQuery({
    queryKey: ['customer-projects', customer?.name, myCompany?.id],
    queryFn: () => (customer && myCompany) ? base44.entities.Project.filter({ customer_name: customer.name, company_id: myCompany.id }) : [],
    enabled: !!customer && !!myCompany,
  });

  const { data: builds = [] } = useQuery({
    queryKey: ['customer-builds', customer?.id, myCompany?.id],
    queryFn: () => (customer && myCompany) ? base44.entities.BuildSchedule.filter({ customer_id: customer.id, company_id: myCompany.id }) : [],
    enabled: !!customer && !!myCompany,
  });

  const { data: materialLists = [] } = useQuery({
    queryKey: ['customer-material-lists', customer?.id, myCompany?.id],
    queryFn: () => (customer?.id && myCompany?.id) ? base44.entities.MaterialList.filter({ customer_id: customer.id, company_id: myCompany.id }) : [],
    enabled: !!customer?.id && !!myCompany?.id,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['customer-tasks', customer?.name, myCompany?.id],
    queryFn: () => (customer && myCompany) ? base44.entities.Task.filter({ related_to: customer.name, company_id: myCompany.id }) : [],
    enabled: !!customer && !!myCompany,
  });

  const { data: customerActionItems = [] } = useQuery({
    queryKey: ['action-items-customer', customer?.id, myCompany?.id],
    queryFn: () => (customer?.id && myCompany?.id) ? base44.entities.ActionItem.filter({ company_id: myCompany.id, related_customer_id: customer.id }) : [],
    enabled: !!customer?.id && !!myCompany?.id,
  });

  const activeCustomerActions = customerActionItems.filter(i => i.status === 'pending' || i.status === 'overdue');

  const { data: customerNoteEntities = [] } = useQuery({
    queryKey: ['customer-notes', customer?.id],
    queryFn: async () => {
      if (!customer?.id) return [];
      return base44.entities.CustomerNote.filter({ customer_id: customer.id }, '-created_date', 500);
    },
    enabled: !!customer?.id,
  });

  const addNoteMutation = useMutation({
    mutationFn: async (noteData) => {
      const newNote = await base44.entities.CustomerNote.create(noteData);
      // Notify all assigned staff + all admins (except the author)
      const adminEmails = staffProfiles.filter(s => s.is_administrator).map(s => s.user_email).filter(Boolean);
      const recipients = [...new Set([...(customer?.assigned_to_users || []), ...adminEmails])].filter(e => e !== noteData.created_by);
      const authorName = noteData.created_by_name || noteData.created_by || 'Someone';
      const profileUrl = window.location.origin + createPageUrl('CustomerProfile') + `?id=${customer.id}`;
      for (const email of recipients) {
        try {
          await base44.entities.Notification.create({
            company_id: customer.company_id,
            user_email: email,
            title: `📝 New Note on ${customer.name}`,
            message: `${authorName} added a note: "${noteData.note.substring(0, 100)}${noteData.note.length > 100 ? '…' : ''}"`,
            type: 'customer_note',
            related_entity_type: 'Customer',
            related_entity_id: customer.id,
            link_url: profileUrl,
            is_read: false,
          });
          await base44.functions.invoke('sendEmailWithBranding', {
            to: email,
            companyId: customer.company_id,
            subject: `New Note on ${customer.name}`,
            html: `<div style="font-family:Arial,sans-serif;color:#333;">
<h2 style="color:#1e40af;">New Note Added</h2>
<p><strong>${authorName}</strong> added a note on customer <strong>${customer.name}</strong>:</p>
<div style="background:#f0f9ff;border-left:4px solid #2563eb;padding:12px;margin:16px 0;border-radius:4px;">
<p style="margin:0;white-space:pre-wrap;">${noteData.note}</p>
</div>
<p><a href="${profileUrl}" style="background:#2563eb;color:white;padding:8px 16px;border-radius:4px;text-decoration:none;display:inline-block;">View Customer Profile</a></p>
</div>`,
          });
        } catch (_) {}
      }
      return newNote;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-notes', customer?.id] });
      setNewNoteText('');
      setShowAddNote(false);
      toast.success('Note added!');
    },
    onError: (err) => toast.error('Failed to add note: ' + err.message),
  });

  const updateNoteMutation = useMutation({
    mutationFn: ({ id, note }) => base44.entities.CustomerNote.update(id, { note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-notes', customer?.id] });
      setEditingNoteId(null);
      toast.success('Note updated');
    },
    onError: (err) => toast.error('Failed to update note: ' + err.message),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (id) => base44.entities.CustomerNote.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-notes', customer?.id] });
      toast.success('Note deleted');
    },
    onError: (err) => toast.error('Failed to delete note: ' + err.message),
  });

  // One-time migration: write legacy JSONB customer_notes to CustomerNote entities on first load
  const migratedCustomerRef = useRef(null);
  useEffect(() => {
    const legacyNotes = customer?.customer_notes || [];
    const hasLegacy = legacyNotes.length > 0;
    const hasEntities = customerNoteEntities.length > 0;
    const alreadyMigrated = migratedCustomerRef.current === customer?.id;

    if (hasLegacy && !hasEntities && customer?.id && !alreadyMigrated) {
      migratedCustomerRef.current = customer.id;
      (async () => {
        try {
          for (const note of legacyNotes) {
            if (!note.note) continue;
            await base44.entities.CustomerNote.create({
              customer_id: customer.id,
              company_id: customer.company_id,
              note: note.note,
              source_type: note.source === 'build_schedule' ? 'build_schedule' : 'manual',
              source_label: note.source_label || null,
              created_by: note.created_by,
              created_by_name: null,
              created_at: note.created_at || new Date().toISOString(),
            });
          }
          queryClient.invalidateQueries({ queryKey: ['customer-notes', customer.id] });
        } catch (e) {
          console.warn('[CustomerProfile] Legacy note migration failed:', e.message);
        }
      })();
    }
  }, [customer?.id, customer?.customer_notes?.length, customerNoteEntities.length]);

  const completeCustomerActionMutation = useMutation({
    mutationFn: (id) => base44.entities.ActionItem.update(id, { status: 'completed', completed_at: new Date().toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action-items-customer'] });
      toast.success('Action item completed');
    },
  });

  const updateCustomerActionMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ActionItem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action-items-customer'] });
    },
  });

  const { data: boards = [] } = useQuery({
    queryKey: ['task-boards', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.TaskBoard.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany,
  });

  const createTaskMutation = useMutation({
    mutationFn: (taskData) => {
      const defaultBoard = boards.find(b => b.is_default) || boards[0];
      
      if (!defaultBoard) {
        throw new Error('No task board found. Please create a task board first in the Tasks page.');
      }

      const defaultColumn = defaultBoard?.columns?.[0]?.id || "not_started";
      const assignedStaff = allCompanyStaff.find(s => s.user_email === (taskData.assigned_to || user?.email));

      return base44.entities.Task.create({
        ...taskData,
        company_id: myCompany?.id,
        board_id: defaultBoard.id,
        column: defaultColumn,
        assignees: assignedStaff ? [{
          email: assignedStaff.user_email,
          name: assignedStaff.full_name,
          avatar: assignedStaff.avatar_url
        }] : [],
        related_to: customer.name,
        source: "customer"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['my-assignments-tasks'] });
      setShowTaskDialog(false);
      setTaskForm({
        name: "",
        description: "",
        priority: "medium",
        due_date: "",
        assigned_to: "",
        status: "not_started"
      });
      toast.success('✅ Task created successfully!');
    },
    onError: (error) => {
      toast.error('Failed to create task: ' + error.message);
    }
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId) => base44.entities.Task.delete(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['my-assignments-tasks'] });
      toast.success('✅ Task deleted successfully!');
    },
    onError: (error) => {
      toast.error('Failed to delete task: ' + error.message);
    }
  });

  const { data: communications = [] } = useQuery({
    queryKey: ['customer-communications', customer?.id, customer?.name, customer?.phone, customer?.phone_2, myCompany?.id],
    queryFn: async () => {
      if (!customer || !myCompany) return [];
      const phoneVariants = (raw) => {
        if (!raw) return [];
        const digits = raw.replace(/\D/g, '');
        const last10 = digits.slice(-10);
        if (last10.length !== 10) return [raw];
        const variants = new Set([raw, last10, `+1${last10}`, `1${last10}`]);
        return [...variants];
      };
      const p1Variants = phoneVariants(customer.phone);
      const p2Variants = phoneVariants(customer.phone_2);
      const allVariants = [...new Set([...p1Variants, ...p2Variants])];
      const phoneQuery = allVariants.length > 0
        ? base44.entities.Communication.filter({ contact_phone: { $in: allVariants }, company_id: myCompany.id })
        : [];
      const [byName, byId, byPhone] = await Promise.all([
        base44.entities.Communication.filter({ contact_name: customer.name, company_id: myCompany.id }),
        customer.id ? base44.entities.Communication.filter({ customer_id: customer.id, company_id: myCompany.id }) : [],
        phoneQuery,
      ]);
      const seen = new Set();
      return [...byName, ...byId, ...byPhone].filter(c => {
        if (!c?.id || seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      }).sort((a, b) => new Date(b.created_date || b.created_at || 0) - new Date(a.created_date || a.created_at || 0));
    },
    enabled: !!customer && !!myCompany,
  });

  const replyFromNumber = React.useMemo(() =>
    communications.find(c => c.direction === 'inbound' && c.data?.company_phone)?.data?.company_phone || null,
    [communications]
  );

  const isCustomerRepOwned = React.useMemo(() => {
    const phones = [customer?.phone, customer?.phone_2].filter(Boolean);
    if (phones.length === 0) return false;
    const outbound = communications.filter(c => c.direction === 'outbound' && c.contact_phone && phones.some(p => c.contact_phone === p || c.contact_phone?.replace(/\D/g,'').endsWith(p?.replace(/\D/g,''))));
    if (outbound.length === 0) return false;
    const latest = [...outbound].sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0))[0];
    return latest?.data?.sent_by_rep === true || latest?.data?.sent_by_rep === 'true';
  }, [communications, customer]);

  const handleLogCall = async (e) => {
    e.preventDefault();
    if (!customer || !myCompany) return;
    setIsLoggingCall(true);
    try {
      await base44.entities.Communication.create({
        communication_type: 'call',
        direction: logCallForm.direction,
        duration_minutes: logCallForm.duration_minutes ? parseFloat(logCallForm.duration_minutes) : null,
        message: logCallForm.notes || '',
        contact_name: customer.name,
        contact_phone: customer.phone || customer.phone_2 || '',
        customer_id: customer.id,
        customer_name: customer.name,
        company_id: myCompany.id,
        created_date: logCallForm.call_date + 'T12:00:00.000Z',
        status: 'completed',
        created_by: effectiveUserEmail,
      });
      queryClient.invalidateQueries({ queryKey: ['customer-communications'] });
      setShowLogCallDialog(false);
      setLogCallForm({ direction: 'inbound', duration_minutes: '', notes: '', call_date: localToday() });
    } catch (err) {
      console.error('Failed to log call:', err);
    } finally {
      setIsLoggingCall(false);
    }
  };

  const handleHandBackToSarahCustomer = async () => {
    const phone = customer?.phone || customer?.phone_2;
    if (!myCompany?.id || !phone) return;
    setIsHandingBackSarah(true);
    try {
      const resp = await base44.functions.invoke('handBackToSarah', { companyId: myCompany.id, contactPhone: phone });
      if (resp?.data?.success) {
        toast.success('Alex is back in control', { description: `Alex will now auto-reply to ${customer?.name || phone}.` });
        queryClient.invalidateQueries({ queryKey: ['customer-communications'] });
      } else {
        toast.error('Could not hand back to Alex', { description: resp?.data?.error || 'Unknown error' });
      }
    } catch (err) {
      toast.error('Could not hand back to Alex', { description: err.message });
    } finally {
      setIsHandingBackSarah(false);
    }
  };

  const { data: proposals = [] } = useQuery({
    queryKey: ['customer-proposals', customer?.name, myCompany?.id],
    queryFn: () => (customer && myCompany) ? base44.entities.Proposal.filter({ customer_name: customer.name, company_id: myCompany.id }) : [],
    enabled: !!customer && !!myCompany,
  });

  const { data: contracts = [] } = useQuery({
    queryKey: ['customer-contracts', customer?.name, myCompany?.id],
    queryFn: () => (customer && myCompany) ? base44.entities.Contract.filter({ customer_name: customer.name, company_id: myCompany.id }) : [],
    enabled: !!customer && !!myCompany,
  });

  const { data: signingsessions = [] } = useQuery({
    queryKey: ['customer-signing-sessions', customer?.id, myCompany?.id],
    queryFn: () => (customer?.id && myCompany?.id) ? base44.entities.ContractSigningSession.filter({ customer_id: customer.id, company_id: myCompany.id }, '-created_date', 200) : [],
    enabled: !!customer?.id && !!myCompany?.id,
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
        queryClient.invalidateQueries({ queryKey: ['customer-signing-sessions', customer?.id, myCompany?.id] });
      } else {
        toast.error(data?.error || 'Failed to re-send signing link');
      }
    } catch (err) {
      toast.error('Failed to re-send signing link: ' + err.message);
    } finally {
      setResendingSessionId(null);
    }
  };

  const { data: calendarEvents = [] } = useQuery({
    queryKey: ['customer-events', customer?.name, myCompany?.id],
    queryFn: () => (customer && myCompany) ? base44.entities.CalendarEvent.filter({ related_customer: customer.name, company_id: myCompany.id }) : [],
    enabled: !!customer && !!myCompany,
  });

  const [showNewAppointmentDialog, setShowNewAppointmentDialog] = useState(false);
  const [newApptForm, setNewApptForm] = useState({ title: '', date: '', time: '09:00', event_type: 'appointment', location: '', description: '' });

  const createAppointmentMutation = useMutation({
    mutationFn: async (form) => {
      const startTime = new Date(`${form.date}T${form.time}:00`).toISOString();
      return base44.entities.CalendarEvent.create({
        title: form.title,
        start_time: startTime,
        end_time: new Date(new Date(startTime).getTime() + 60 * 60000).toISOString(),
        event_type: form.event_type,
        location: form.location,
        description: form.description,
        related_customer: customer?.name,
        customer_id: customer?.id,
        company_id: myCompany?.id,
        assigned_to: user?.email,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-events'] });
      setShowNewAppointmentDialog(false);
      setNewApptForm({ title: '', date: '', time: '09:00', event_type: 'appointment', location: '', description: '' });
      toast.success('Appointment scheduled');
    },
    onError: (err) => toast.error('Failed to schedule: ' + err.message),
  });

  const { data: inspectionJobs = [] } = useQuery({
    queryKey: ['customer-inspection-jobs', customer?.id, myCompany?.id],
    staleTime: 3 * 60 * 1000,
    queryFn: async () => {
      if (!customer || !myCompany) return [];
      const cid = myCompany.id;
      const byId = await base44.entities.InspectionJob.filter({ related_customer_id: customer.id, company_id: cid });
      if (byId && byId.length > 0) return byId;

      // Fallback: search by client_phone or client_name when related_customer_id was never backfilled
      const candidates = [];
      if (customer.phone) {
        const byPhone = await base44.entities.InspectionJob.filter({ client_phone: customer.phone, company_id: cid });
        if (byPhone?.length) candidates.push(...byPhone);
      }
      if (candidates.length === 0 && customer.name) {
        const byName = await base44.entities.InspectionJob.filter({ client_name: customer.name, company_id: cid });
        if (byName?.length) candidates.push(...byName);
      }

      // Deduplicate
      const seen = new Set();
      const unique = candidates.filter(j => !seen.has(j.id) && seen.add(j.id));

      // Backfill related_customer_id so future lookups hit the fast path
      for (const job of unique) {
        if (!job.related_customer_id) {
          base44.entities.InspectionJob.update(job.id, { related_customer_id: customer.id }).catch(() => {});
        }
      }

      return unique;
    },
    enabled: !!customer && !!myCompany,
  });

  const { data: inspectionMedia = [] } = useQuery({
    queryKey: ['customer-inspection-media', inspectionJobs.map(j => j.id).join(',')],
    staleTime: 3 * 60 * 1000,
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

  const { data: crewPhotos = [], isLoading: crewPhotosLoading } = useQuery({
    queryKey: ['customer-crew-photos', customer?.id],
    queryFn: () => customer?.id
      ? base44.entities.JobMedia.filter({ related_entity_type: 'Customer', related_entity_id: customer.id }, '-created_date', 200).then(all => all.filter(m => m.source === 'crew_upload' || m.source === 'whatsapp_upload'))
      : [],
    enabled: !!customer?.id,
    staleTime: 3 * 60 * 1000,
  });
  const crewPhotoSharing = useCrewPhotoSharing(customer?.id, myCompany?.id, activeSection === 'crew-photos');

  const { data: files = [] } = useQuery({
    queryKey: ['customer-files', customer?.id, myCompany?.id],
    queryFn: async () => {
      if (!customer || !myCompany) return [];
      const cid = myCompany.id;
      const byName = await base44.entities.Document.filter({ related_customer: customer.name, company_id: cid });
      const byId = await base44.entities.Document.filter({ related_entity_id: customer.id, company_id: cid });
      
      // Merge and deduplicate
      const allFiles = [...byName, ...byId];
      const uniqueFiles = allFiles.filter((file, index, self) => 
        index === self.findIndex(f => f.id === file.id)
      );
      return uniqueFiles;
    },
    // The sidebar displays this same collection's count. Loading only after
    // opening the tab leaves the Files badge at zero even when documents
    // already exist.
    enabled: !!customer && !!myCompany,
    staleTime: 0,
  });

  const { data: customerExpenses = [] } = useQuery({
    queryKey: ['customer-expenses', customer?.id, myCompany?.id],
    queryFn: () => (customer && myCompany) ? base44.entities.Expense.filter({ customer_id: customer.id, company_id: myCompany.id }) : [],
    enabled: !!customer && !!myCompany,
  });

  useEffect(() => {
    if (showPaymentDialog && invoices.length > 0) {
      if (!paymentForm.invoice_number && paymentForm.amount === "") {
        const unpaidInvoice = invoices.find(inv =>
          ['sent', 'draft', 'viewed', 'overdue', 'partially_paid'].includes(inv.status) &&
          (inv.amount || 0) > (inv.amount_paid || 0)
        );
        if (unpaidInvoice) {
          setPaymentForm(prev => ({
            ...prev,
            invoice_number: unpaidInvoice.invoice_number,
            amount: (unpaidInvoice.amount - (unpaidInvoice.amount_paid || 0)).toFixed(2)
          }));
        }
      }
    }
  }, [showPaymentDialog, invoices, paymentForm.invoice_number, paymentForm.amount]);

  const toggleActiveMutation = useMutation({
    mutationFn: async (newActive) => {
      return base44.entities.Customer.update(customer.id, { is_active: newActive });
    },
    onSuccess: (_, newActive) => {
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
      toast.success(newActive ? 'Customer reactivated' : 'Customer deactivated');
    },
    onError: (err) => toast.error('Failed: ' + (err.message || 'Unknown error')),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data, originalAssignedUsers, originalCommissionSplits }) => {
      const { data: legacyData, ...payload } = data;
      payload.name = String(payload.name || '').trim();
      if (!payload.name) throw new Error('Enter the customer’s full name before saving.');
      const updatedCustomer = await base44.entities.Customer.update(id, payload);
      if (updatedCustomer.id !== id || updatedCustomer.name !== payload.name) {
        throw new Error('The customer name was not saved correctly. Please try again.');
      }
      customerDraft.current = { id, dirty: false };
      cacheSavedCustomer(queryClient, updatedCustomer);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      let photoSyncNameSyncError = null;
      if (updatedCustomer.name?.trim() !== customer?.name?.trim()) {
        try {
          await syncPhotoSyncClientNames(base44.entities.InspectionJob, updatedCustomer, myCompany?.id);
        } catch (error) {
          photoSyncNameSyncError = error.message;
          console.error('Customer name saved but PhotoSync name sync failed:', error);
        }
      }

      // 🔥 UPDATE ALL INVOICES when assignment or commission splits change
      if (myCompany?.id && updatedCustomer.assigned_to_users) {
        const assignmentChanged = originalAssignedUsers &&
          JSON.stringify([...(originalAssignedUsers)].sort()) !== JSON.stringify([...(updatedCustomer.assigned_to_users)].sort());
        const splitsChanged = JSON.stringify(originalCommissionSplits || []) !== JSON.stringify(updatedCustomer.commission_splits || []);
        
        // Always fetch invoices so we can detect stale commission splits
        const customerInvoices = await base44.entities.Invoice.filter({ 
          customer_name: updatedCustomer.name,
          company_id: myCompany.id
        });

        // Detect stale splits: invoice has someone no longer in assigned_to_users
        const currentAssigned = new Set(updatedCustomer.assigned_to_users || []);
        const hasStaleCommissionSplits = customerInvoices.some(invoice =>
          (invoice.commission_splits || []).some(split => !currentAssigned.has(split.user_email))
        );

        if (assignmentChanged || splitsChanged || hasStaleCommissionSplits) {
          if (hasStaleCommissionSplits && !assignmentChanged) {
            console.log('🧹 Stale commission splits detected — recalculating to match current assignment');
          } else {
            console.log('💼 Assignment or commission splits changed, updating invoices...');
          }
          
          // Use manually-set customer commission_splits if available, otherwise auto-calculate
          let newCommissionSplits = null;
          let primaryAgent = null;

          if (updatedCustomer.commission_splits && updatedCustomer.commission_splits.length > 0) {
            // 🎯 Manual splits set in customer profile — use those
            newCommissionSplits = updatedCustomer.commission_splits;
            primaryAgent = newCommissionSplits[0];
            console.log('💰 Using manual commission splits:', newCommissionSplits.map(s => `${s.user_name} ${s.split_percentage}%`));
          } else if (updatedCustomer.assigned_to_users.length > 0) {
            // Auto-calculate from assigned staff with commission rates
            const allStaffProfiles = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
            const assignedWithCommission = updatedCustomer.assigned_to_users
              .map(email => allStaffProfiles.find(s => s.user_email === email))
              .filter(profile => profile && profile.commission_rate > 0);
            console.log('💰 Assigned staff with commission rates:', assignedWithCommission.map(s => s.full_name));
            if (assignedWithCommission.length > 0) {
              const splitPercentage = 100 / assignedWithCommission.length;
              newCommissionSplits = assignedWithCommission.map(profile => ({
                user_email: profile.user_email,
                user_name: profile.full_name || profile.user_email,
                split_percentage: splitPercentage,
                role: 'Sales Rep'
              }));
              primaryAgent = { user_email: assignedWithCommission[0].user_email, user_name: assignedWithCommission[0].full_name };
            } else {
              console.log('⚠️ No assigned users have commission rates enabled');
            }
          }

          if (newCommissionSplits && customerInvoices.length > 0) {
            for (let i = 0; i < customerInvoices.length; i++) {
              const invoice = customerInvoices[i];
              await base44.entities.Invoice.update(invoice.id, {
                ...(primaryAgent ? { sale_agent: primaryAgent.user_email, sale_agent_name: primaryAgent.user_name } : {}),
                commission_splits: newCommissionSplits
              });
              console.log(`✅ Updated invoice ${invoice.invoice_number} with splits`);
              if ((i + 1) % 5 === 0 && i < customerInvoices.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 200));
              }
            }
          }
        }

        const newlyAssigned = updatedCustomer.assigned_to_users.filter(
          (email) => !originalAssignedUsers.includes(email)
        );

        if (newlyAssigned.length > 0) {
          console.log('📧 Sending assignment emails to newly assigned:', newlyAssigned);
          
          const allStaffProfiles = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
          const adminEmails = myCompany?.created_by ? [myCompany.created_by] : [];
          const notifyEmails = [...new Set([...newlyAssigned, ...adminEmails])];

          console.log('📧 Total recipients (newly assigned + admins):', notifyEmails);

          let emailsSent = 0;
          let emailsFailed = 0;
          
          for (const email of notifyEmails) {
            try {
              const isNewlyAssigned = newlyAssigned.includes(email);
              
              await base44.entities.Notification.create({
                company_id: myCompany.id,
                user_email: email,
                title: '👤 Customer Assignment',
                message: isNewlyAssigned 
                  ? `You have been assigned to customer: ${updatedCustomer.name}`
                  : `Customer ${updatedCustomer.name} was assigned to new staff`,
                type: 'customer_created',
                related_entity_type: 'Customer',
                related_entity_id: updatedCustomer.id,
                link_url: createPageUrl('CustomerProfile') + `?id=${updatedCustomer.id}`,
                is_read: false,
              });

              const assignmentHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>body { font-family: Arial, sans-serif; color: #333; } h2 { color: #1e40af; margin-bottom: 16px; } p { margin: 8px 0; line-height: 1.6; } strong { font-weight: bold; } a { color: #2563eb; text-decoration: none; } a:hover { text-decoration: underline; } .success { color: #16a34a; font-weight: bold; } .footer { font-size: 12px; color: #666; margin-top: 20px; border-top: 1px solid #ddd; padding-top: 10px; }</style></head>
<body>
<h2>Customer Assignment Update</h2>
${isNewlyAssigned ? '<p class="success">✓ You have been assigned to a new customer!</p>' : '<p>A customer has been assigned to new staff.</p>'}
<div style="background: #f0f9ff; border-left: 4px solid #2563eb; padding: 12px; margin: 16px 0; border-radius: 4px;">
<p><strong>Customer:</strong> ${updatedCustomer.name}</p>
<p><strong>Email:</strong> ${updatedCustomer.email || 'N/A'}</p>
<p><strong>Phone:</strong> ${updatedCustomer.phone || 'N/A'}</p>
<p><strong>Address:</strong> ${[updatedCustomer.street, updatedCustomer.city, updatedCustomer.state, updatedCustomer.zip].filter(Boolean).join(', ') || 'N/A'}</p>
<p><strong>Assigned To:</strong> ${(updatedCustomer.assigned_to_users || []).map(e => { const sp = allStaffProfiles.find(s => s.user_email === e); return sp?.full_name || sp?.name || e; }).join(', ') || 'N/A'}</p>
</div>
<p><a href="${window.location.origin + createPageUrl('CustomerProfile') + `?id=${updatedCustomer.id}`}" style="background: #2563eb; color: white; padding: 8px 16px; border-radius: 4px; text-decoration: none; display: inline-block;">View Customer Profile</a></p>
<div class="footer">Updated by: ${user?.full_name || user?.email}</div>
</body>
</html>`;
              await base44.functions.invoke('sendEmailWithBranding', {
                to: email,
                subject: `Customer Assignment: ${updatedCustomer.name}`,
                html: assignmentHtml,
                companyId: myCompany.id,
              });
              
              console.log('✅ Email sent to:', email);
              emailsSent++;
            } catch (error) {
              console.error(`❌ Failed to send notification to ${email}:`, error);
              emailsFailed++;
            }
          }
        }
      }

      return { updatedCustomer, emailsSent: 0, emailsFailed: 0, photoSyncNameSyncError };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer'] });
      queryClient.invalidateQueries({ queryKey: ['customer-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
      queryClient.invalidateQueries({ queryKey: ['inspectionJob'] });
      queryClient.invalidateQueries({ queryKey: ['customer-inspection-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['photoSyncCustomer'] });
      queryClient.invalidateQueries({ queryKey: ['photoSyncCustomerNames'] });
      if (data.photoSyncNameSyncError) {
        toast.error(`Customer name saved, but PhotoSync could not update all linked jobs: ${data.photoSyncNameSyncError}`);
        return;
      }
      
      if (data.emailsSent > 0 || data.emailsFailed > 0) {
        toast.success(`Customer updated! Sent ${data.emailsSent} email(s). ${data.emailsFailed > 0 ? `${data.emailsFailed} failed.` : ''}`, {
          duration: 5000
        });
      } else {
        toast.success('Customer updated!');
      }
    },
    onError: (error) => {
      console.error("Failed to update customer:", error);
      toast.error(`❌ Failed to update customer: ${error.message}`);
    }
  });

  const isHeicFile = (filename) => {
    return filename?.toLowerCase().endsWith('.heic') || filename?.toLowerCase().endsWith('.heif');
  };

  const uploadFileMutation = useMutation({
    mutationFn: async (data) => {
      if (!myCompany?.id) {
        throw new Error("Company ID not available for file upload.");
      }
      if (!data.files || data.files.length === 0) {
        throw new Error("No files selected for upload.");
      }
      
      const heicFiles = Array.from(data.files).filter(f => isHeicFile(f.name));
      if (heicFiles.length > 0) {
        const heicNames = heicFiles.map(f => f.name).join(', ');
        alert(`⚠️ Warning: HEIC files detected (${heicNames}).\n\nHEIC is Apple's format and won't display in browsers.\n\nPlease convert to JPG/PNG first, or they will show as broken images.`);
      }
      
      const uploadPromises = data.files.map(async (file, index) => {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        
        console.log('File uploaded:', { file_url, fileName: file.name, fileType: file.type });
        
        return base44.entities.Document.create({
          company_id: myCompany.id,
          document_name: data.label ? `${data.label} ${data.files.length > 1 ? index + 1 : ''}`.trim() : file.name,
          file_url: file_url,
          file_size: file.size,
          file_type: file.type,
          category: data.category || "other",
          related_customer: customer.name,
          description: data.notes,
          is_customer_visible: true
        });
      });
      return Promise.all(uploadPromises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-files'] });
      setShowFileUpload(false);
      setFileForm({ label: "", category: "", notes: "", files: [] });
      toast.success('✅ File(s) uploaded successfully!');
    },
    onError: (error) => {
      console.error("File upload failed:", error);
      toast.error("File upload failed: " + error.message);
    }
  });

  const deleteFileMutation = useMutation({
    mutationFn: (id) => base44.entities.Document.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-files'] });
      toast.success('✅ File deleted successfully!');
    },
    onError: (error) => {
      console.error("File deletion failed:", error);
      toast.error("File deletion failed: " + error.message);
    }
  });

  const updateFileMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Document.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-files'] });
      setShowEditDialog(false);
      setEditingFile(null);
      toast.success('✅ File updated successfully!');
    },
    onError: (error) => {
      console.error("File update failed:", error);
      toast.error("File update failed: " + error.message);
    }
  });

  const createPaymentMutation = useMutation({
    mutationFn: async (paymentData) => {
      if (!customer) {
        throw new Error("Customer not found for payment.");
      }
      if (!myCompany?.id) {
        throw new Error("Company ID not available for payment.");
      }

      console.log('🔵 Starting payment creation from Customer Profile...');
      
      const allPayments = await base44.entities.Payment.filter({ company_id: myCompany.id }, '-created_date', 10000);
      const numbers = allPayments
        .map(p => p.payment_number)
        .filter(num => num && num.startsWith('PAY-'))
        .map(num => parseInt(num.replace(/PAY-\d{4}-|[^\d]/g, '')))
        .filter(num => !isNaN(num));
      
      const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
      const paymentNumber = `PAY-${new Date().getFullYear()}-${String(maxNumber + 1).padStart(4, '0')}`;
      
      // Trim invoice number to avoid whitespace issues
      const cleanInvoiceNumber = paymentData.invoice_number ? paymentData.invoice_number.trim() : "";

      // Resolve the invoice ONCE, up front, and reuse it for the link, the
      // commission, the workflow and the recalculation. Invoice numbers are not
      // unique, so if the number can't be pinned to a single invoice we refuse
      // rather than file the money against an arbitrary one.
      let targetInvoice = null;
      if (cleanInvoiceNumber) {
        const picked = pickInvoiceForPayment(
          invoices.filter(inv => (inv.invoice_number || '').trim() === cleanInvoiceNumber),
          { customerName: customer?.name, customerId: customer?.id }
        );
        if (picked.ambiguous) {
          throw new Error(
            `${picked.candidateCount} invoices are numbered ${cleanInvoiceNumber}, so this payment can't be filed safely. Open the correct invoice and record the payment from there.`
          );
        }
        targetInvoice = picked.invoice || null;
      }
      
      // Map non-standard payment methods to 'other' and preserve the original in notes
      const standardMethods = ['cash','check','credit_card','bank_transfer','paypal','stripe','other'];
      const isNonStandard = !standardMethods.includes(paymentData.payment_method);
      const mappedMethod = isNonStandard ? 'other' : paymentData.payment_method;
      const readableMethod = paymentData.payment_method.replace(/_/g, ' ');
      const finalNotes = isNonStandard
        ? (paymentData.notes ? `${paymentData.notes} | Recorded via ${readableMethod}` : `Recorded via ${readableMethod}`)
        : paymentData.notes;

      const newPayment = await base44.entities.Payment.create({
        amount: paymentData.amount,
        payment_method: mappedMethod,
        payment_date: paymentData.payment_date,
        payer_name: paymentData.payer_name?.trim() || customer.name,
        payer_email: paymentData.payer_email?.trim() || customer.email || "",
        customer_email: customer.email || "",
        reference_number: paymentData.reference_number,
        notes: finalNotes,
        invoice_number: cleanInvoiceNumber,
        payment_number: paymentNumber,
        customer_name: customer.name,
        customer_id: customer.id,
        invoice_id: targetInvoice?.id || null,
        status: 'received',
        company_id: myCompany.id,
      });
      console.log('✅ Payment created:', newPayment.payment_number);

      try {
        let salesRepEmails = [];
        let commissionSplits = null;
        
        if (paymentData.invoice_number) {
          const invoice = targetInvoice;
          if (invoice?.commission_splits?.length > 0) {
            commissionSplits = invoice.commission_splits;
            salesRepEmails = invoice.commission_splits.map(cs => cs.user_email);
          } else if (customer?.commission_splits?.length > 0) {
            // 🎯 Use customer-level splits if invoice doesn't have them yet
            commissionSplits = customer.commission_splits;
            salesRepEmails = customer.commission_splits.map(cs => cs.user_email);
          } else if (invoice?.sale_agent) {
            salesRepEmails = [invoice.sale_agent];
          }
        }
        
        if (salesRepEmails.length === 0) {
          salesRepEmails = customer.assigned_to_users || (customer.assigned_to ? [customer.assigned_to] : []);
        }
        
        if (salesRepEmails.length > 0) {
          console.log('💰 Updating commissions for:', salesRepEmails);
          const invoiceId = targetInvoice?.id || null;
          const totalAmount = parseFloat(paymentData.amount);
          for (const salesRepEmail of salesRepEmails) {
            // Calculate this person's share of the payment based on their split_percentage
            const splitInfo = commissionSplits?.find(cs => cs.user_email === salesRepEmail);
            const splitRatio = splitInfo ? (splitInfo.split_percentage / 100) : (1 / salesRepEmails.length);
            const effectiveAmount = totalAmount * splitRatio;
            await base44.functions.invoke('updateCommissions', {
              paymentId: newPayment.id,
              invoiceId,
              amount: effectiveAmount,
              salesRepEmail: salesRepEmail
            });
            console.log(`✅ Commission updated for ${salesRepEmail}: $${effectiveAmount.toFixed(2)} (${(splitRatio*100).toFixed(0)}% of $${totalAmount})`);
          }
        }
      } catch (commError) {
        console.error('⚠️ Commission update failed (non-critical):', commError);
      }

      if (paymentData.invoice_number) {
        const invoice = targetInvoice;
        if (invoice) {
          // Always use backend recalculation for accuracy
          await base44.functions.invoke('recalculateInvoicePayments', {
            invoice_id: invoice.id
          });

          const newTotalPaid = Number(invoice.amount_paid || 0) + parseFloat(paymentData.amount);
          const newStatus = newTotalPaid >= Number(invoice.amount) && Number(invoice.amount) > 0
            ? 'paid'
            : newTotalPaid > 0 ? 'partially_paid' : 'sent';

          if (newStatus === 'paid' && myCompany?.id) {
            try {
              await base44.functions.invoke('executeWorkflow', {
                triggerType: 'invoice_paid',
                entityType: 'Invoice',
                entityId: invoice.id,
                entityData: {
                  ...invoice,
                  amount_paid: newTotalPaid,
                  status: newStatus,
                  customer_name: customer.name,
                  customer_email: customer.email,
                  invoice_number: invoice.invoice_number,
                  amount: invoice.amount,
                },
                companyId: myCompany.id
              });
            } catch (error) {
              console.error('⚠️ Workflow trigger failed (non-critical):', error);
            }
          }
        }
      }

      // 🔔 USE UNIVERSAL NOTIFICATION DISPATCHER
      let notificationResult = { successCount: 0, errorCount: 0, errors: [] };
      try {
        const response = await base44.functions.invoke('universalNotificationDispatcher', {
          action: 'create',
          entityType: 'Payment',
          entityId: newPayment.id,
          entityData: newPayment,
          companyId: myCompany.id
        });
        notificationResult = response.data;
        console.log('✅ Universal notifications sent:', notificationResult);
      } catch (error) {
        console.error('Notification dispatcher failed:', error);
        notificationResult.errors.push(error.message);
      }

      // 💌 Send receipt to customer (separate from staff notifications)
      if (customer.email && paymentData.send_receipt) {
        try {
          await base44.functions.invoke('sendEmailWithBranding', {
            to: customer.email,
            companyId: myCompany.id,
            subject: `Payment Receipt - $${Number(newPayment.amount || 0).toFixed(2)}`,
            html: `<h2>Payment Received - Thank You!</h2>
              <p>Dear ${newPayment.customer_name},</p>
              <p>We have received your payment. Here are the details:</p>
              <p><strong>Amount:</strong> $${Number(newPayment.amount || 0).toFixed(2)}</p>
              <p><strong>Payment Date:</strong> ${format(parsePaymentDate(newPayment.payment_date), 'MMM d, yyyy')}</p>
              <p><strong>Payment Method:</strong> ${newPayment.payment_method}</p>
              ${newPayment.invoice_number ? `<p><strong>Invoice:</strong> ${newPayment.invoice_number}</p>` : ''}
              <p>Thank you for your business!</p>
              <p>Best regards,<br/>${myCompany.company_name || 'Your Team'}</p>`
          });
          console.log('✅ Customer receipt sent');
        } catch (error) {
          console.error('Customer receipt failed:', error);
        }
      }

      try {
        await base44.functions.invoke('triggerWorkflow', {
          triggerType: 'payment_received',
          companyId: myCompany.id,
          entityType: 'Payment',
          entityId: newPayment.id,
          entityData: {
            payment_number: newPayment.payment_number,
            customer_name: newPayment.customer_name,
            customer_email: customer.email || '',
            amount: newPayment.amount,
            payment_method: newPayment.payment_method,
            invoice_number: newPayment.invoice_number,
            payment_date: newPayment.payment_date,
            app_url: window.location.origin
          }
        });
        console.log('✅ Workflow triggered');
      } catch (error) {
        console.error('Workflow failed:', error);
      }

      return { 
        newPayment, 
        notificationsSent: notificationResult.successCount, 
        emailsSent: notificationResult.successCount,
        totalRecipients: notificationResult.successCount,
        errors: notificationResult.errors || []
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
      queryClient.invalidateQueries({ queryKey: ['customer-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['staff-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      // Force immediate refetch so invoice balances update right away
      queryClient.refetchQueries({ queryKey: ['customer-invoices'] });
      queryClient.refetchQueries({ queryKey: ['customer-payments'] });
      setShowPaymentDialog(false);
      setPaymentForm({
        amount: "",
        payment_method: "cash",
        payment_date: localToday(),
        payer_name: customer?.name || "",
        payer_email: customer?.email || "",
        invoice_number: "",
        reference_number: "",
        notes: "",
        send_receipt: true
      });
      const invoiceRef = result?.newPayment?.invoice_number ? ` on ${result.newPayment.invoice_number}` : '';
      let message = `✅ Payment recorded${invoiceRef}! Invoice balance updated.`;
      toast.success(message, { duration: 5000 });
      
      if (result.errors && result.errors.length > 0) {
        console.error('Notification errors:', result.errors);
      }
    },
    onError: (error) => {
      console.error("Failed to record payment:", error);
      toast.error(`❌ Failed to record payment: ${error.message}`);
    }
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (paymentId) => {
      const payment = payments.find(p => p.id === paymentId);
      if (!payment) {
        throw new Error("Payment not found");
      }
      if (!myCompany?.id || payment.company_id !== myCompany.id) {
        throw new Error('Cannot delete a payment outside the active company.');
      }

      const reversal = await reverseStandaloneDeduction({ payment, companyId: myCompany.id, invoke: base44.functions.invoke });
      if (reversal.handled) {
        return { payment, recalcFailed: false, notificationsSent: 0, emailsSent: 0 };
      }

      const companyInvoices = invoices.filter(inv => !inv.company_id || inv.company_id === myCompany.id);
      const exactInvoice = payment.invoice_id
        ? companyInvoices.find(inv => inv.id === payment.invoice_id)
        : null;
      const matchesInv = makeInvoiceMatcher(companyInvoices);
      const legacyInvoice = !payment.invoice_id
        ? companyInvoices.find(inv => matchesInv(payment, inv))
        : null;
      const invoiceIdForRecalc = exactInvoice?.id || legacyInvoice?.id || null;

      // Delete first. A cached subtraction before this write can be applied twice
      // when deletion fails and the page refreshes before the user retries.
      await base44.entities.Payment.delete(paymentId);

      let recalcFailed = false;
      if (invoiceIdForRecalc) {
        try {
          const raw = await base44.functions.invoke('recalculateInvoicePayments', {
            invoice_id: invoiceIdForRecalc,
          });
          const result = raw?.data ?? raw;
          if (result?.success !== true) {
            throw new Error(result?.error || 'Invoice recalculation was not confirmed.');
          }
        } catch (error) {
          console.error('Invoice recalculation after payment deletion failed:', error);
          recalcFailed = true;
        }
      } else if (payment.invoice_id || payment.invoice_number) {
        recalcFailed = true;
      }

      // 🔔 Send notifications via universal dispatcher
      try {
        const response = await base44.functions.invoke('universalNotificationDispatcher', {
          action: 'delete',
          entityType: 'Payment',
          entityId: payment.id,
          entityData: payment,
          companyId: myCompany.id
        });
        console.log('✅ Delete notifications sent:', response.data);
        return { 
          payment,
          recalcFailed,
          notificationsSent: response.data.successCount,
          emailsSent: response.data.successCount 
        };
      } catch (error) {
        console.error('Notification dispatcher failed:', error);
        return { payment, recalcFailed, notificationsSent: 0, emailsSent: 0 };
      }
    },
    onSuccess: (result) => {
      if (result.recalcFailed) {
        toast.warning('Payment deleted but balance could not be recalculated; open invoice and use Sync Payments', { duration: 8000 });
      } else {
        toast.success(`Payment and any matching fee-deduction expense deleted! Sent ${result.emailsSent} notifications to admins.`);
      }
    },
    onError: (error) => {
      console.error("Failed to delete payment:", error);
      toast.error(`❌ Failed to delete payment: ${error.message}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['customer-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
  });

  const updatePaymentMutation = useMutation({
    mutationFn: async () => {
      if (!editPaymentForm.id) throw new Error('No payment selected');
      const standardMethods2 = ['cash','check','credit_card','bank_transfer','paypal','stripe','other'];
      const isNonStd = !standardMethods2.includes(editPaymentForm.payment_method);
      const mapped = isNonStd ? 'other' : editPaymentForm.payment_method;
      const readableM = editPaymentForm.payment_method.replace(/_/g, ' ');
      const finalNotes = isNonStd
        ? (editPaymentForm.notes ? `${editPaymentForm.notes} | Recorded via ${readableM}` : `Recorded via ${readableM}`)
        : editPaymentForm.notes;
      const cleanInvoiceNumber = (editPaymentForm.invoice_number || '').trim();
      const previousPayment = payments.find((p) => p.id === editPaymentForm.id);
      let targetInvoice = null;
      if (cleanInvoiceNumber) {
        const picked = pickInvoiceForPayment(
          invoices.filter((inv) => (inv.invoice_number || '').trim() === cleanInvoiceNumber),
          { customerName: customer?.name, customerId: customer?.id }
        );
        if (picked.ambiguous) {
          throw new Error(
            `${picked.candidateCount} invoices are numbered ${cleanInvoiceNumber}. Open the correct invoice and apply the payment there.`
          );
        }
        if (!picked.invoice) {
          throw new Error(`Invoice ${cleanInvoiceNumber} was not found for this customer.`);
        }
        targetInvoice = picked.invoice;
      }
      const updated = await base44.entities.Payment.update(editPaymentForm.id, {
        amount: parseFloat(editPaymentForm.amount),
        payment_method: mapped,
        payment_date: editPaymentForm.payment_date,
        payer_name: editPaymentForm.payer_name?.trim() || '',
        payer_email: editPaymentForm.payer_email?.trim() || '',
        reference_number: editPaymentForm.reference_number || '',
        notes: finalNotes,
        invoice_number: targetInvoice?.invoice_number || '',
        invoice_id: targetInvoice?.id || null,
      });
      // Recalculate both sides when a payment is moved or unlinked. invoice_id is
      // authoritative; invoice numbers are not unique.
      const invoiceIdsToRecalculate = new Set([
        previousPayment?.invoice_id,
        targetInvoice?.id,
      ].filter(Boolean));
      for (const invoiceId of invoiceIdsToRecalculate) {
        const response = await base44.functions.invoke('recalculateInvoicePayments', { invoice_id: invoiceId });
        if (response?.data?.success === false) {
          throw new Error(response.data.error || 'Invoice balance could not be recalculated.');
        }
      }
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
      queryClient.invalidateQueries({ queryKey: ['customer-invoices'] });
      queryClient.refetchQueries({ queryKey: ['customer-payments'] });
      queryClient.refetchQueries({ queryKey: ['customer-invoices'] });
      setShowEditPaymentDialog(false);
      toast.success('✅ Payment updated successfully!');
    },
    onError: (e) => {
      toast.error('Failed to update payment: ' + e.message);
    }
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoiceId) => {
      await base44.entities.Invoice.delete(invoiceId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-invoices'] });
      toast.success('✅ Invoice deleted successfully!');
    },
    onError: (error) => {
      console.error("Failed to delete invoice:", error);
      toast.error(`❌ Failed to delete invoice: ${error.message}`);
    }
  });

  const doSaveCustomer = (dataToSave, originalAssignedUsers, originalCommissionSplits) => {
    updateMutation.mutate({ id: customer.id, data: dataToSave, originalAssignedUsers, originalCommissionSplits });
  };

  const handleSaveCustomer = (e) => {
    e.preventDefault();

    const phoneErr = validateE164Phone(customerData.phone || '');
    const phone2Err = validateE164Phone(customerData.phone_2 || '');
    const adjPhoneErr = validateE164Phone(customerData.adjuster_phone || '');
    const newPhoneErrors = { phone: phoneErr, phone_2: phone2Err, adjuster_phone: adjPhoneErr };
    setPhoneErrors(newPhoneErrors);
    if (phoneErr || phone2Err || adjPhoneErr) {
      toast.error('Customer not saved. Please correct the highlighted phone number fields.');
      return;
    }

    if (customer && customerData) {
      const originalAssignedUsers = customer.assigned_to_users || [];
      let dataToSave = { ...customerData };

      // If the notes field has content that isn't already in customer_notes, add it
      const notesText = (customerData.notes || '').trim();
      const existingStructuredNotes = customer.customer_notes || [];
      const alreadyInNotes = existingStructuredNotes.some(n => n.note === notesText);
      if (notesText && !alreadyInNotes) {
        const newNote = {
          id: `note_profile_${Date.now()}`,
          note: notesText,
          created_at: new Date().toISOString(),
          created_by: user?.email || 'system',
          source: 'profile_edit'
        };
        dataToSave.customer_notes = [...existingStructuredNotes, newNote];
      }

      const originalCommissionSplits = customer.commission_splits || [];

      // 🤔 Smart prompt: if 2+ people with commission rates are assigned but no splits set, suggest splitting
      const noSplitsSet = !dataToSave.commission_splits || dataToSave.commission_splits.length === 0;
      if (noSplitsSet) {
        const assignedWithRate = (dataToSave.assigned_to_users || [])
          .map(email => staffProfiles.find(s => s.user_email === email))
          .filter(s => s && s.commission_rate > 0);

        if (assignedWithRate.length >= 2) {
          // Pause save and prompt user
          setSuggestedSplitStaff(assignedWithRate);
          setPendingSaveArgs({ dataToSave, originalAssignedUsers, originalCommissionSplits });
          setShowCommissionSplitPrompt(true);
          return;
        }
      }

      doSaveCustomer(dataToSave, originalAssignedUsers, originalCommissionSplits);
    }
  };

  const handleFileUpload = async () => {
    if (!fileForm.files || fileForm.files.length === 0) {
      toast.error("Please select at least one file.");
      return;
    }
    if (!fileForm.category) {
      toast.error("Please select a category for the files.");
      return;
    }
    if (!myCompany?.id) {
      toast.error("Company information is not loaded yet. Please try again.");
      return;
    }
    setUploadingFile(true);
    try {
      await uploadFileMutation.mutateAsync(fileForm);
    } catch (error) {
      // Error is already logged in mutation's onError
    } finally {
      setUploadingFile(false);
    }
  };

  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return;
    
    const newCategoryValue = newCategoryName.toLowerCase().replace(/\s+/g, '_');
    if (allCategories.some(cat => cat.value === newCategoryValue)) {
      toast.error("A category with this name already exists.");
      return;
    }

    const newCategory = {
      value: newCategoryValue,
      label: newCategoryName.trim(),
      icon: "📁",
      custom: true
    };
    
    const updated = [...customCategories, newCategory];
    setCustomCategories(updated);
    if (myCompany?.id) {
      localStorage.setItem(`custom_categories_${myCompany.id}`, JSON.stringify(updated));
    }
    setNewCategoryName("");
  };

  const handleDeleteCategory = (categoryValue) => {
    if (!window.confirm('Are you sure you want to delete this custom category? Files assigned to this category will remain, but will effectively become uncategorized until re-assigned.')) return;
    
    const updated = customCategories.filter(c => c.value !== categoryValue);
    setCustomCategories(updated);
    if (myCompany?.id) {
      localStorage.setItem(`custom_categories_${myCompany.id}`, JSON.stringify(updated));
    }
  };

  const handleImageError = (fileId, fileUrl) => {
    console.error('Image failed to load:', { 
      fileId, 
      fileUrl: typeof fileUrl === 'string' ? fileUrl : JSON.stringify(fileUrl) 
    });
    setImageErrors(prev => ({ ...prev, [fileId]: true }));
  };

  const handleDownload = async (file) => {
    try {
      const response = await fetch(file.file_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.document_name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error('Download failed:', error);
      toast.error('Download failed');
    }
  };

  const handleEditFile = (file) => {
    setEditingFile(file);
    setEditForm({
      document_name: file.document_name || "",
      category: file.category || "",
      description: file.description || ""
    });
    setShowEditDialog(true);
  };

  const handleUpdateFile = () => {
    if (!editForm.document_name) {
      toast.error("Please enter a file name.");
      return;
    }
    if (!editForm.category) {
      toast.error("Please select a category for the file.");
      return;
    }
    updateFileMutation.mutate({
      id: editingFile.id,
      data: {
        document_name: editForm.document_name,
        category: editForm.category,
        description: editForm.description
      }
    });
  };

  const handleDeleteInvoice = (invoice) => {
    if (!isAdmin) {
      toast.error('⛔ Access Denied\n\nOnly administrators can delete invoices.');
      return;
    }

    if (window.confirm(`Delete invoice ${invoice.invoice_number}?\n\nAmount: $${invoice.amount}\n\nThis cannot be undone!`)) {
      deleteInvoiceMutation.mutate(invoice.id);
    }
  };

  const handleEditInvoice = (invoice) => {
    navigate(createPageUrl('invoice-details') + `?id=${invoice.id}`);
  };

  const handleCreateEstimate = () => {
    if (!customer) return;
    
    const fullAddress = [customer.street, customer.city, customer.state, customer.zip]
      .filter(Boolean)
      .join(', ');
    
    const params = new URLSearchParams({
      customer_id: customer.id,
      customer_name: customer.name,
      customer_email: customer.email || '',
      customer_phone: customer.phone || '',
      property_address: fullAddress || '',
      insurance_company: customer.insurance_company || '',
      claim_number: customer.claim_number || '',
      adjuster_name: customer.adjuster_name || '',
      adjuster_phone: customer.adjuster_phone || ''
    });
    
    navigate(createPageUrl('AIEstimator') + '?' + params.toString());
  };

  const handleCreateInvoice = () => {
    if (!customer) return;
    
    const params = new URLSearchParams({
      prefill: 'true',
      customer_id: customer.id,
      customer_name: customer.name,
      customer_email: customer.email || '',
      create_new: 'true'
    });
    
    navigate(createPageUrl('Invoices') + '?' + params.toString());
  };

  const handleCreateProject = () => {
    if (!customer) return;
    
    const params = new URLSearchParams({
      prefill: 'true',
      customer_name: customer.name,
      create_new: 'true'
    });
    
    navigate(createPageUrl('Projects') + '?' + params.toString());
  };

  const handleRecordPayment = (e) => {
    e.preventDefault();
    if (!customer) {
      toast.error('Customer information is not available.');
      return;
    }
    if (!paymentForm.amount || parseFloat(paymentForm.amount) <= 0) {
      toast.error('Please enter a valid payment amount.');
      return;
    }
    const payerEmail = String(paymentForm.payer_email || '').trim().toLowerCase();
    const customerEmail = String(customer.email || '').trim().toLowerCase();
    if (payerEmail && customerEmail && payerEmail !== customerEmail) {
      const confirmed = window.confirm(
        `The payer email (${paymentForm.payer_email}) does not match ${customer.name} (${customer.email}).\n\n` +
        `This payment will still be applied to ${customer.name}${paymentForm.invoice_number ? ` on ${paymentForm.invoice_number}` : ''}. Continue?`
      );
      if (!confirmed) return;
    }
    createPaymentMutation.mutate({
      ...paymentForm,
      amount: parseFloat(paymentForm.amount)
    });
  };

  const handlePaymentDialogChange = (open) => {
    if (!open) {
      // The payment form is now reset in onSuccess
    }
    setShowPaymentDialog(open);
  };

  const filesByCategory = files.reduce((acc, file) => {
    const cat = file.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(file);
    return acc;
  }, {});

  // Add CrewCam inspection photos to files (from Document records already created)
  const allFilesWithInspections = React.useMemo(() => {
    const combined = { ...filesByCategory };
    // Photos are already in files via Document records, no need to duplicate from inspectionMedia
    return combined;
  }, [filesByCategory]);

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

  const allCategories = [...defaultCategories, ...customCategories];

  const handleFileSelect = (fileId) => {
    setSelectedFiles(prev => {
      if (prev.includes(fileId)) {
        return prev.filter(id => id !== fileId);
      } else {
        return [...prev, fileId];
      }
    });
  };

  const handleSelectAllInCategory = (categoryFiles) => {
    const categoryImageFileIds = categoryFiles.filter(f => f.file_type?.startsWith('image/')).map(f => f.id);
    const allSelected = categoryImageFileIds.length > 0 && categoryImageFileIds.every(id => selectedFiles.includes(id));
    
    if (allSelected) {
      setSelectedFiles(prev => prev.filter(id => !categoryImageFileIds.includes(id)));
    } else {
      setSelectedFiles(prev => [...new Set([...prev, ...categoryImageFileIds])]);
    }
  };

  const handleDownloadSelectedAsPDF = async () => {
    if (selectedFiles.length === 0) {
      toast.info('Please select at least one photo to download.');
      return;
    }

    setIsGeneratingPDF(true);

    try {
      const selectedFileObjects = files.filter(f => selectedFiles.includes(f.id) && f.file_type?.startsWith('image/'));
      
      if (selectedFileObjects.length === 0) {
        toast.warning('⚠️ No image files selected. Please select photos to create a PDF.');
        setIsGeneratingPDF(false);
        return;
      }

      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 15;
      const contentWidth = pageWidth - (margin * 2);

      // Header
      doc.setFontSize(20);
      doc.text(customer.name || 'Customer Photos', margin, margin + 10);
      
      doc.setFontSize(10);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin, margin + 18);
      
      let isFirstPhoto = true;

      for (const file of selectedFileObjects) {
        try {
          if (!isFirstPhoto) {
            doc.addPage();
          }
          isFirstPhoto = false;

          // Category and file name
          const categoryLabel = allCategories.find(c => c.value === file.category)?.label || file.category;
          doc.setFontSize(14);
          doc.text(categoryLabel || 'Photo', margin, margin + 25); // Adjusted Y for header and date

          doc.setFontSize(10);
          doc.text(file.document_name || 'Untitled', margin, margin + 33); // Adjusted Y

          // Add image
          const response = await fetch(file.file_url);
          const blob = await response.blob();
          
          const imageDataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          const imgProps = doc.getImageProperties(imageDataUrl);
          const imgHeight = (imgProps.height * contentWidth) / imgProps.width;
          
          // Ensure image fits on page, if not, scale down
          let finalImgHeight = imgHeight;
          if (finalImgHeight > (pageHeight - margin * 2 - 50)) { // 50 for title/desc space
            finalImgHeight = (pageHeight - margin * 2 - 50);
          }

          doc.addImage(imageDataUrl, imgProps.fileType, margin, margin + 40, contentWidth, finalImgHeight); // Adjusted Y

          // Description
          if (file.description) {
            doc.setFontSize(9);
            doc.setTextColor(80);
            const descLines = doc.splitTextToSize(file.description, contentWidth);
            doc.text(descLines, margin, margin + 40 + finalImgHeight + 5); // Adjusted Y
            doc.setTextColor(0);
          }

        } catch (error) {
          console.error('Failed to add image to PDF:', error);
          // Continue to next image even if one fails
        }
      }

      const pdfBytes = doc.output('arraybuffer');
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${customer.name?.replace(/[^a-zA-Z0-9]/g, '_')}_Photos_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      toast.success(`✅ PDF created with ${selectedFileObjects.length} photo${selectedFileObjects.length > 1 ? 's' : ''}!`);
      setSelectedFiles([]);

    } catch (error) {
      console.error('PDF generation failed:', error);
      toast.error('❌ Failed to create PDF: ' + error.message);
    }

    setIsGeneratingPDF(false);
  };

  const handleCheckUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const targetInvoice = checkInvoiceId && checkInvoiceId !== '__unlinked__'
      ? outstandingInvoicesForCheck.find((inv) => inv.id === checkInvoiceId)
      : null;
    if (outstandingInvoicesForCheck.length > 0 && !checkInvoiceId) {
      toast.error('Choose which invoice this check should pay before taking the photo.');
      e.target.value = '';
      return;
    }

    setIsProcessingCheck(true);
    try {
      // 1. Upload file first
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      // 2. Call backend function with JSON
      const payload = {
        fileUrl: file_url,
        customerId: customer.id,
        customerName: customer.name,
        companyId: myCompany?.id,
        invoiceId: targetInvoice?.id || null,
        invoiceNumber: targetInvoice?.invoice_number || null,
        file_size: file.size,
        file_type: file.type
      };

      const result = await base44.functions.invoke('processCheckPayment', payload);

      if (result.data?.success) {
        const extracted = result.data.extracted_data;
        toast.success(`✅ Check Payment Recorded!\n\nAmount: $${Number(extracted.amount || 0).toFixed(2)}\nCheck #: ${extracted.check_number || 'N/A'}\nDate: ${extracted.check_date || 'N/A'}\nPayer: ${extracted.payer_name || 'N/A'}`, {
          duration: 6000
        });
        queryClient.invalidateQueries({ queryKey: ['customer-payments'] });
        queryClient.invalidateQueries({ queryKey: ['customer-files'] });
        queryClient.invalidateQueries({ queryKey: ['payments'] });
        queryClient.invalidateQueries({ queryKey: ['customer-invoices'] });
        queryClient.refetchQueries({ queryKey: ['customer-invoices'] });
        setShowCheckUploadDialog(false);
        setCheckInvoiceId('');
      } else {
        const errMsg = result.data?.error || result.error || 'Could not process check. Make sure your Gemini AI key is configured in Settings.';
        toast.error(errMsg, { duration: 8000 });
      }
    } catch (error) {
      console.error('Error processing check:', error);
      toast.error('Failed to process check: ' + error.message);
    } finally {
      setIsProcessingCheck(false);
    }
  };

  // 1) Show loading while URL params not parsed yet, or query is actively fetching,
  //    or customer was found but the form state (customerData) hasn't been synced by useEffect yet
  // (also stay on the loader while candidate records are being checked, or a
  //  redirect to the one match found is about to happen)
  if (!customerId || isLoadingCustomers || (customer && !customerData) ||
      (!customer && (isLoadingNameCandidates || candidateTargetUrl))) {
    return (
      <div className="p-3 sm:p-6">
        <Card className="p-12 text-center flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400 mb-4" />
          <p className="text-gray-500">Loading customer profile...</p>
        </Card>
      </div>
    );
  }

  // 1b) Show "access denied" if user doesn't have access to this customer
  if (customer && !isLoadingCustomers && !canAccessCustomer) {
    return (
      <div className="p-3 sm:p-6">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="outline" onClick={() => navigate(createPageUrl('Customers'))}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Customers
          </Button>
        </div>
        <Card className="p-12 text-center">
          <p className="text-gray-500">You don't have access to this customer profile.</p>
        </Card>
      </div>
    );
  }

  // 1c) Several records share this name — ask which one instead of guessing.
  //     Picking one at random would open the wrong invoices and payments.
  if (!customer && candidateVerdict?.action === 'choose') {
    return (
      <div className="p-3 sm:p-6">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="outline" onClick={() => navigate(createPageUrl('Customers'))}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Customers
          </Button>
        </div>
        <Card className="p-8">
          <p className="text-gray-700 font-medium mb-1">
            {candidateVerdict.candidates.length} records are named “{customerNameFromUrl || customerId}”
          </p>
          <p className="text-gray-500 text-sm mb-6">
            This estimate doesn't say which one it belongs to. Pick the right file to open it.
          </p>
          <div className="space-y-2">
            {candidateVerdict.candidates.map((c) => (
              <button
                key={`${c.kind}-${c.id}`}
                onClick={() => navigate(
                  createPageUrl(c.kind === 'lead' ? 'LeadProfile' : 'CustomerProfile') + '?id=' + encodeURIComponent(c.id)
                )}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 text-left transition-colors"
              >
                <span className="font-medium text-gray-900">{c.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${c.kind === 'lead' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                  {c.kind === 'lead' ? 'Lead' : 'Customer'}
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  // 2) Show "not found" only after the query has settled with no result
  if (!customer) {
    return (
      <div className="p-3 sm:p-6">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="outline" onClick={() => navigate(createPageUrl('Customers'))}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Customers
          </Button>
        </div>
        <Card className="p-12 text-center">
          <p className="text-gray-500">
            {customerNameFromUrl
              ? `No customer or lead named “${customerNameFromUrl}” exists yet. The record may have been renamed or deleted after this estimate was created.`
              : 'Customer not found'}
          </p>
          <Button 
            variant="link" 
            onClick={() => queryClient.invalidateQueries({ queryKey: ['customer', customerId] })}
            className="mt-4"
          >
            Try Refreshing
          </Button>
        </Card>
      </div>
    );
  }

  const sections = [
    { id: "profile", label: "Profile", icon: User },
    { id: "notes", label: "Notes", icon: FileText, count: customerNoteEntities.length + tasks.length + communications.length || customer?.customer_notes?.length || 0 },
    { id: "documents", label: "Documents & Reports", icon: Folder, count: files.length + estimates.length + invoices.length + proposals.length + contracts.length },
    { id: "invoices", label: "Invoices", icon: Receipt, count: invoices.length },
    { id: "payments", label: "Payments", icon: DollarSign, count: payments.length },
    { id: "expenses", label: "Expenses", icon: Receipt, count: customerExpenses.length },
    { id: "commissions", label: "Commissions", icon: CreditCard },
    { id: "proposals", label: "Proposals", icon: FileSignature, count: proposals.length },
    { id: "estimates", label: "Estimates", icon: FileText, count: estimates.length },
    { id: "contracts", label: "Contracts", icon: FileSignature, count: contracts.length + signingsessions.length },
    { id: "projects", label: "Projects", icon: Briefcase, count: projects.length },
    { id: "schedule-build", label: "Schedule Build", icon: Wrench, count: builds.length },
    { id: "tasks", label: "Tasks", icon: CheckSquare, count: tasks.length },
    { id: "communications", label: "Communications", icon: MessageSquare, count: communications.length },
    { id: "calendar", label: "Calendar", icon: Calendar, count: calendarEvents.length },
    { id: "files", label: "Files", icon: Folder, count: files.length },
    { id: "action-items", label: "Action Items", icon: Bell, count: activeCustomerActions.length },
    { id: "reminders", label: "Reminders", icon: Bell, count: 0 },
    { id: "crewcam", label: "PhotoSync", icon: Camera, count: inspectionJobs.length },
    { id: "crew-photos", label: "Crew Photos", icon: Image, count: crewPhotos.length, subtitle: crewPhotos.length > 0 ? `${crewPhotos.filter(p => p.source === 'whatsapp_upload').length} WhatsApp · ${crewPhotos.filter(p => p.source === 'crew_upload').length} Standard` : null },
    { id: "material-lists", label: "Material Lists", icon: ShoppingCart, count: materialLists.length },
    ...(HIDDEN_FEATURES.COLOR_VISUALIZER !== false ? [{ id: "color-visualizer", label: "Color Visualizer", icon: Palette }] : []),
  ];

  const totalRevenue = [...payments.filter(p => p.status === 'received'), ...invoices.filter(i => i.status === 'paid')].reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const openEstimates = estimates.filter(e => ['draft', 'sent', 'viewed'].includes(e.status) && !e.supplement_of).reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const groupedEstimates = (() => {
    const originals = estimates.filter(e => !e.supplement_of);
    const supplements = estimates.filter(e => !!e.supplement_of);
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
  const unpaidInvoices = invoices.filter(i => ['sent', 'overdue', 'partially_paid'].includes(i.status)).reduce((sum, i) => sum + Number(i.amount || 0), 0);
  const totalExpenses = customerExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  // Format date-only strings (YYYY-MM-DD) as local dates to avoid UTC shifting a day back
  const formatDateOnly = (dateStr) => {
    if (!dateStr) return '';
    try {
      if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [y, m, d] = dateStr.split('-').map(Number);
        const dt = new Date(y, m - 1, d); // local date
        return format(dt, 'MMM d, yyyy');
      }
      const dt = new Date(dateStr);
      return format(dt, 'MMM d, yyyy');
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <nav className="flex items-center gap-1.5 text-sm text-gray-500">
        <button
          onClick={() => navigate(createPageUrl('Customers'))}
          className="hover:text-blue-600 transition-colors flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Customers
        </button>
        <span>/</span>
        <span className="text-gray-800 font-medium truncate max-w-[220px]">{customer.name}</span>
      </nav>
      <Card className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
        <CardContent className="p-3 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center">
                <User className="w-10 h-10 text-blue-600" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">{customer.name}</h1>
                {customer.company && (
                  <p className="text-blue-100 text-lg">{customer.company}</p>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge
                    variant="secondary"
                    className={`cursor-pointer transition-opacity hover:opacity-80 ${customer.is_active ? "bg-green-500" : "bg-gray-500"}`}
                    onClick={() => {
                      if (customer.is_active) {
                        setDeactivateConfirmOpen(true);
                      } else {
                        toggleActiveMutation.mutate(true);
                      }
                    }}
                    title={customer.is_active ? "Click to deactivate" : "Click to reactivate"}
                    data-testid="badge-active-status"
                  >
                    {toggleActiveMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin mr-1 inline" />
                    ) : customer.is_active ? (
                      <UserCheck className="w-3 h-3 mr-1 inline" />
                    ) : (
                      <UserX className="w-3 h-3 mr-1 inline" />
                    )}
                    {customer.is_active ? "Active" : "Inactive"}
                  </Badge>
                  {customer.customer_type && (
                    <Badge variant="secondary" className="bg-purple-500">
                      {customer.customer_type}
                    </Badge>
                  )}
                  {customer.tags?.map((tag, idx) => (
                    <Badge key={idx} variant="secondary" className="bg-blue-500">
                      {tag}
                    </Badge>
                  ))}
                  {(() => {
                    const totalContracts = contracts.length + signingsessions.length;
                    if (totalContracts === 0) return null;
                    const pendingContracts =
                      signingsessions.filter(s => s.status !== 'completed').length +
                      contracts.filter(c => c.status === 'draft').length;
                    return (
                      <Badge
                        variant="secondary"
                        className={`cursor-pointer gap-1 ${
                          pendingContracts > 0
                            ? "bg-amber-400 text-amber-950 hover:bg-amber-300"
                            : "bg-green-500 text-white hover:bg-green-400"
                        }`}
                        data-testid="badge-contracts-summary"
                        onClick={() => setActiveSection('contracts')}
                      >
                        <FileSignature className="w-3 h-3" />
                        {totalContracts} contract{totalContracts !== 1 ? 's' : ''}
                        {pendingContracts > 0 && ` — ${pendingContracts} pending`}
                      </Badge>
                    );
                  })()}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:flex lg:flex-row lg:flex-wrap gap-2">
              <Button 
                onClick={handleCreateEstimate}
                className="bg-white text-blue-600 hover:bg-blue-50"
              >
                <FileText className="w-4 h-4 mr-2" />
                New Estimate
              </Button>
              <Button 
                onClick={handleCreateInvoice}
                className="bg-white text-blue-600 hover:bg-blue-50"
              >
                <DollarSign className="w-4 h-4 mr-2" />
                New Invoice
              </Button>
              <Button 
                onClick={handleCreateProject}
                className="bg-white text-blue-600 hover:bg-blue-50"
              >
                <Briefcase className="w-4 h-4 mr-2" />
                New Project
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="bg-white text-blue-600 hover:bg-blue-50"
                    data-testid="button-contact-dropdown"
                  >
                    <Phone className="w-4 h-4 mr-2" />
                    Contact
                    <ChevronDown className="w-3 h-3 ml-1.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    onClick={() => setShowDialer(true)}
                    data-testid="menu-item-call"
                    className="cursor-pointer"
                  >
                    <Phone className="w-4 h-4 mr-2 text-blue-600" />
                    Call
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setShowSMSDialog(true)}
                    data-testid="menu-item-text"
                    className="cursor-pointer"
                  >
                    <MessageSquare className="w-4 h-4 mr-2 text-green-600" />
                    Text
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setShowEmailDialog(true)}
                    data-testid="menu-item-email"
                    className="cursor-pointer"
                  >
                    <Mail className="w-4 h-4 mr-2 text-purple-600" />
                    Email
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button 
                onClick={() => setShowPortalDialog(true)}
                className="bg-white text-purple-600 hover:bg-purple-50"
                data-testid="button-portal-link"
              >
                <User className="w-4 h-4 mr-2" />
                Send Portal Link
              </Button>
              <Button
                data-testid="button-crew-upload-link"
                onClick={copyCrewUploadLink}
                className="bg-white text-orange-600 hover:bg-orange-50"
              >
                <Upload className="w-4 h-4 mr-2" />
                Crew Upload Link
              </Button>
              <Button
                data-testid="button-send-for-signature"
                onClick={() => {
                  setSignatureSelectedTemplate(null);
                  setSignatureContractForm({ contract_name: "", delivery_method: "email" });
                  setShowSendForSignatureDialog(true);
                }}
                className="bg-white text-green-600 hover:bg-green-50"
              >
                <FileSignature className="w-4 h-4 mr-2" />
                Send for Signature
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="profile" value={activeSection} onValueChange={setActiveSection} className="w-full">
        <div className="flex">
          <div className="w-64 bg-white border-r min-h-screen">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-1">
                {sections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                        activeSection === section.id
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 shrink-0" />
                        <div className="flex flex-col items-start">
                          <span>{section.label}</span>
                          {section.subtitle && (
                            <span className="text-xs font-normal text-gray-400 leading-tight">{section.subtitle}</span>
                          )}
                        </div>
                      </div>
                      {section.count !== undefined && section.count > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {section.count}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          <div className="flex-1 p-6">
            <TabsContent value="profile" className="mt-0">
              {activeSection === "profile" && (
                <form onSubmit={handleSaveCustomer} className="space-y-6">
                  {signingsessions.length > 0 && (() => {
                    const latest = signingsessions[0];
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
                        data-testid="card-latest-contract-summary"
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
                  <Card>
                    <CardHeader>
                      <CardTitle>Customer Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Primary Contact Name</Label>
                          <Input
                            value={customerData.name}
                            disabled={updateMutation.isPending}
                            onChange={(e) => setCustomerData({...customerData, name: e.target.value})}
                            required
                          />
                        </div>
                        <div>
                          <Label>Company</Label>
                          <Input
                            value={customerData.company}
                            onChange={(e) => setCustomerData({...customerData, company: e.target.value})}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Phone</Label>
                          <Input
                            type="tel"
                            value={customerData.phone}
                            onChange={(e) => {
                              setCustomerData({...customerData, phone: e.target.value});
                              setPhoneErrors(prev => ({ ...prev, phone: validateE164Phone(e.target.value) }));
                            }}
                            className={phoneErrors.phone ? "border-red-500" : ""}
                          />
                          {phoneErrors.phone && <p className="text-sm text-red-500 mt-1">{phoneErrors.phone}</p>}
                        </div>
                        <div>
                          <Label>Phone 2</Label>
                          <Input
                            type="tel"
                            value={customerData.phone_2}
                            onChange={(e) => {
                              setCustomerData({...customerData, phone_2: e.target.value});
                              setPhoneErrors(prev => ({ ...prev, phone_2: validateE164Phone(e.target.value) }));
                            }}
                            className={phoneErrors.phone_2 ? "border-red-500" : ""}
                          />
                          {phoneErrors.phone_2 && <p className="text-sm text-red-500 mt-1">{phoneErrors.phone_2}</p>}
                        </div>
                      </div>

                      <div>
                        <Label>Email</Label>
                        <Input
                          type="email"
                          value={customerData.email}
                          onChange={(e) => setCustomerData({...customerData, email: e.target.value})}
                        />
                      </div>

                      <div className="border-t pt-4">
                        <h3 className="font-semibold mb-3">Address</h3>
                        {(() => {
                          const addr = [customer?.street, customer?.city, customer?.state, customer?.zip].filter(Boolean).join(', ');
                          return addr ? <PropertyFrontView address={addr} className="mb-4" /> : null;
                        })()}
                        <div className="space-y-4">
                          <div>
                            <Label>Street Address</Label>
                            <Input
                              value={customerData.street}
                              onChange={(e) => setCustomerData({...customerData, street: e.target.value})}
                              placeholder="123 Main Street"
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                              <Label>City</Label>
                              <Input
                                value={customerData.city}
                                onChange={(e) => setCustomerData({...customerData, city: e.target.value})}
                                placeholder="Cleveland"
                              />
                            </div>
                            <div>
                              <Label>State</Label>
                              <Input
                                value={customerData.state}
                                onChange={(e) => setCustomerData({...customerData, state: e.target.value})}
                                placeholder="OH"
                                maxLength={2}
                              />
                            </div>
                            <div>
                              <Label>Zip Code</Label>
                              <Input
                                value={customerData.zip}
                                onChange={(e) => setCustomerData({...customerData, zip: e.target.value})}
                                placeholder="44101"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Installer</Label>
                          <InstallerSelect
                            values={customerData.installers}
                            onChange={(vals) => setCustomerData({...customerData, installers: vals})}
                            companyId={myCompany?.id}
                          />
                        </div>
                        <div>
                          <Label>Vendor Name</Label>
                          <VendorSelect
                            values={customerData.vendor_names}
                            onChange={(vals) => setCustomerData({...customerData, vendor_names: vals})}
                            companyId={myCompany?.id}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Material Color</Label>
                          <MaterialColorSelect
                            values={customerData.material_colors}
                            onChange={(vals) => setCustomerData({...customerData, material_colors: vals})}
                            companyId={myCompany?.id}
                          />
                        </div>
                        <div>
                          <Label>Material Brand</Label>
                          <MaterialBrandSelect
                            values={customerData.material_brands}
                            onChange={(vals) => setCustomerData({...customerData, material_brands: vals})}
                            companyId={myCompany?.id}
                          />
                        </div>
                      </div>

                      <div>
                        <Label>Assigned To</Label>
                        <Select
                          value={customerData.assigned_to_users?.[0] || customerData.assigned_to || ""}
                          onValueChange={(v) => {
                            const currentUsers = customerData.assigned_to_users || [];
                            let updatedUsers = [];

                            if (v === 'clear_all') {
                              updatedUsers = [];
                            } else if (currentUsers.includes(v)) {
                              updatedUsers = currentUsers.filter(u => u !== v);
                            } else {
                              updatedUsers = [...currentUsers, v];
                            }
                            
                            setCustomerData({
                              ...customerData, 
                              assigned_to_users: updatedUsers,
                              assigned_to: updatedUsers[0] || ""
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={
                              customerData.assigned_to_users && customerData.assigned_to_users.length > 0
                                ? `${customerData.assigned_to_users.length} assigned`
                                : "Select staff members"
                            } />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="clear_all">Clear All</SelectItem>
                            {allCompanyStaff.filter(s => s.user_email).map(staff => {
                              const isSelected = customerData.assigned_to_users?.includes(staff.user_email);
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
                        {customerData.assigned_to_users && customerData.assigned_to_users.length > 0 && (
                          <div className="mt-2 flex -space-x-2">
                            {customerData.assigned_to_users.map(email => {
                              const staff = allCompanyStaff.find(s => s.user_email === email);
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
                        )}
                      </div>

                      <div>
                        <Label>Groups</Label>
                        <CustomerGroupSelect
                          value={customerData.groups || []}
                          onChange={(groups) => setCustomerData({
                            ...customerData,
                            groups,
                            group: groups[0] || ""
                          })}
                          companyId={myCompany?.id}
                        />
                      </div>

                      <div>
                        <Label>Tags</Label>
                        <CustomerTagSelect
                          value={customerData.tags || []}
                          onChange={(tags) => setCustomerData({...customerData, tags})}
                          companyId={myCompany?.id}
                        />
                      </div>

                      <div>
                        <Label>Referred By <span className="text-gray-400 font-normal text-xs">(optional)</span></Label>
                        <Input
                          value={customerData.referral_source || ''}
                          onChange={(e) => setCustomerData({...customerData, referral_source: e.target.value})}
                          placeholder="Name of person who referred this customer"
                          data-testid="input-edit-referred-by"
                        />
                      </div>

                      <div className="flex items-center gap-3 pt-2">
                        <Switch
                          checked={customerData.is_active}
                          onCheckedChange={(checked) => setCustomerData({...customerData, is_active: checked})}
                        />
                        <Label>Active</Label>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Commission Splits Card */}
                  <Card className="border-green-200">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-green-600" />
                        Commission Splits
                      </CardTitle>
                      <p className="text-xs text-gray-500">
                        Specify who earns commission from this customer's payments. Percentages represent each person's share of the total invoice amount used to calculate their commission.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {(customerData.commission_splits || []).length === 0 && (
                        <p className="text-sm text-gray-400 italic">No splits set — commissions will follow assigned staff with a commission rate.</p>
                      )}
                      {(customerData.commission_splits || []).map((split, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
                          <div className="flex-1">
                            <p className="text-sm font-medium">{split.user_name || split.user_email}</p>
                            <p className="text-xs text-gray-500">{split.role || 'Co-Rep'}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min="1"
                              max="100"
                              className="w-16 h-7 text-sm text-center"
                              value={split.split_percentage}
                              onChange={(e) => {
                                const updated = [...(customerData.commission_splits || [])];
                                updated[idx] = { ...split, split_percentage: parseFloat(e.target.value) || 0 };
                                setCustomerData({ ...customerData, commission_splits: updated });
                              }}
                            />
                            <span className="text-sm text-gray-500">%</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const updated = (customerData.commission_splits || []).filter((_, i) => i !== idx);
                              setCustomerData({ ...customerData, commission_splits: updated });
                            }}
                            className="text-red-400 hover:text-red-600 p-1"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}

                      {/* Add split person */}
                      <div className="flex items-center gap-2 pt-1">
                        <Select
                          value=""
                          onValueChange={(email) => {
                            const staff = staffProfiles.find(s => s.user_email === email);
                            if (!staff) return;
                            const alreadyAdded = (customerData.commission_splits || []).some(s => s.user_email === email);
                            if (alreadyAdded) return;
                            const existing = customerData.commission_splits || [];
                            const newSplit = {
                              user_email: email,
                              user_name: staff.full_name || email,
                              split_percentage: 50,
                              role: 'Co-Rep'
                            };
                            setCustomerData({ ...customerData, commission_splits: [...existing, newSplit] });
                          }}
                        >
                          <SelectTrigger className="flex-1 h-8 text-sm" data-testid="select-add-commission-split">
                            <SelectValue placeholder="+ Add person to split..." />
                          </SelectTrigger>
                          <SelectContent>
                            {staffProfiles
                              .filter(s => s.user_email && !(customerData.commission_splits || []).some(cs => cs.user_email === s.user_email))
                              .map(s => (
                                <SelectItem key={s.user_email} value={s.user_email}>
                                  <span className="flex items-center gap-2">
                                    {s.full_name || s.user_email}
                                    {s.commission_rate > 0
                                      ? <span className="text-xs text-green-600">({s.commission_rate}% rate)</span>
                                      : <span className="text-xs text-gray-400">(no commission rate)</span>
                                    }
                                  </span>
                                </SelectItem>
                              ))
                            }
                          </SelectContent>
                        </Select>
                      </div>

                      {(customerData.commission_splits || []).length > 0 && (() => {
                        const total = (customerData.commission_splits || []).reduce((sum, s) => sum + (parseFloat(s.split_percentage) || 0), 0);
                        return total !== 100 ? (
                          <p className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1">
                            ⚠ Splits total {total}% — adjust to reach 100% for full commission coverage
                          </p>
                        ) : (
                          <p className="text-xs text-green-600 bg-green-50 rounded px-2 py-1">
                            ✓ Splits total 100%
                          </p>
                        );
                      })()}

                      <p className="text-xs text-gray-400">
                        Note: In-house staff (e.g., coordinators, assistants) should be left off the splits list. Only add outside sales reps or referral agents who earn commission.
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Insurance Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label>Insurance Company</Label>
                          <Input
                            value={customerData.insurance_company}
                            onChange={(e) => setCustomerData({...customerData, insurance_company: e.target.value})}
                            placeholder="e.g., State Farm"
                          />
                        </div>
                        <div>
                          <Label>Claim Number</Label>
                          <Input
                            value={customerData.claim_number}
                            onChange={(e) => setCustomerData({...customerData, claim_number: e.target.value})}
                            placeholder="e.g., CLM-123456"
                          />
                        </div>
                        <div>
                          <Label>Adjuster Name</Label>
                          <Input
                            value={customerData.adjuster_name}
                            onChange={(e) => setCustomerData({...customerData, adjuster_name: e.target.value})}
                          />
                        </div>
                        <div>
                          <Label>Adjuster Phone</Label>
                          <Input
                            value={customerData.adjuster_phone}
                            onChange={(e) => {
                              setCustomerData({...customerData, adjuster_phone: e.target.value});
                              setPhoneErrors(prev => ({ ...prev, adjuster_phone: validateE164Phone(e.target.value) }));
                            }}
                            className={phoneErrors.adjuster_phone ? "border-red-500" : ""}
                          />
                          {phoneErrors.adjuster_phone && <p className="text-sm text-red-500 mt-1">{phoneErrors.adjuster_phone}</p>}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-3 sm:p-6">
                      <div>
                        <Label>Notes</Label>
                        <Textarea
                          value={customerData.notes}
                          onChange={(e) => setCustomerData({...customerData, notes: e.target.value})}
                          rows={4}
                          placeholder="Internal notes about this customer..."
                        />
                      </div>
                    </CardContent>
                  </Card>

                  <div className="flex justify-end gap-2">
                    <Button type="submit" disabled={updateMutation.isPending} className="bg-blue-600 hover:bg-blue-700">
                      <Save className="w-4 h-4 mr-2" />
                      {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                    </Button>
                  </div>
                </form>
              )}
            </TabsContent>

            <TabsContent value="invoices" className="mt-0">
              {activeSection === "invoices" && (
                <Card>
                  <CardContent className="p-3 sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold">Invoices ({invoices.length})</h2>
                    </div>
                    <div className="space-y-3">
                      {invoices.map((invoice) => (
                        <div key={invoice.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                          <div className="flex-1 cursor-pointer" onClick={() => navigate(createPageUrl('invoice-details') + `?id=${invoice.id}`)}>
                            <div className="font-medium">{invoice.invoice_number}</div>
                            <div className="text-sm text-gray-500">
                              Due: {invoice.due_date ? formatDateOnly(invoice.due_date) : 'No due date'}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="font-semibold text-green-600">${Number(invoice.amount || 0).toFixed(2)}</div>
                              <Badge variant="outline" className={
                                invoice.status === 'paid' ? 'bg-green-100 text-green-700' :
                                invoice.status === 'partially_paid' ? 'bg-yellow-100 text-yellow-700' :
                                invoice.status === 'overdue' ? 'bg-red-100 text-red-700' :
                                'bg-blue-100 text-blue-700'
                              }>
                                {invoice.status}
                              </Badge>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-10 w-10"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreVertical className="w-5 h-5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleEditInvoice(invoice)}>
                                  <Pencil className="w-4 h-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                {isAdmin && (
                                  <DropdownMenuItem 
                                    onClick={() => handleDeleteInvoice(invoice)}
                                    className="text-red-600"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      ))}
                      {invoices.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                          No invoices yet
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="payments" className="mt-0">
              {activeSection === "payments" && (
                <Card>
                  <CardContent className="p-3 sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold">Payments ({payments.length})</h2>
                      <div className="flex gap-2">
                        <Button 
                          onClick={() => {
                            setCheckInvoiceId(
                              outstandingInvoicesForCheck.length === 1
                                ? outstandingInvoicesForCheck[0].id
                                : ''
                            );
                            setShowCheckUploadDialog(true);
                          }}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          <Camera className="w-4 h-4 mr-2" />
                          Scan Check
                        </Button>
                        <Button 
                          onClick={() => {
                            setPaymentForm(prev => ({
                              ...prev,
                              payer_name: prev.payer_name || customer.name || "",
                              payer_email: prev.payer_email || customer.email || "",
                            }));
                            setShowPaymentDialog(true);
                          }}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Record Payment
                        </Button>
                      </div>
                    </div>
                    {payments.length > 0 && (
                      <div className="flex items-center justify-between px-4 py-2.5 mb-3 bg-green-50 border border-green-200 rounded-lg">
                        <span className="text-sm font-medium text-green-800">Total Amount Paid</span>
                        <span className="text-lg font-bold text-green-700">
                          ${payments.reduce((sum, p) => sum + Number(p.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                    {paymentSourceWarnings.length > 0 && (
                      <Alert className="mb-3 border-amber-300 bg-amber-50">
                        <AlertTriangle className="h-4 w-4 text-amber-700" />
                        <AlertDescription className="text-amber-900">
                          {paymentSourceWarnings.length} payment{paymentSourceWarnings.length === 1 ? '' : 's'} contain a payer email that does not match {customer.name}. Review the highlighted “Paid by” details before changing ownership.
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="space-y-3">
                      {payments.map((payment) => {
                        const payer = getPaymentPayerDetails(payment);
                        const payerMismatch = paymentPayerDiffersFromCustomer(payment, customer);
                        return (
                        <div key={payment.id} className={`flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 group ${payerMismatch ? 'border-amber-300 bg-amber-50/40' : ''}`}>
                          <div>
                            <div className="font-medium">{payment.payment_number}</div>
                            <div className="text-sm text-gray-500">
                            {parsePaymentDate(payment.payment_date) ? format(parsePaymentDate(payment.payment_date), 'MMM d, yyyy') : ''}
                            </div>
                            <div className="text-xs text-gray-400">{payment.payment_method}</div>
                            {payment.invoice_number && (
                               <div className="text-xs text-blue-600 mt-1">Applied to: {customer.name} · Invoice {payment.invoice_number}</div>
                            )}
                             <div className={`text-xs mt-1 ${payerMismatch ? 'font-semibold text-amber-800' : 'text-gray-500'}`}>
                               Paid by: {payer.name || payer.email || 'Not recorded'}
                               {payer.name && payer.email ? ` · ${payer.email}` : ''}
                             </div>
                             {payerMismatch && (
                               <div className="text-xs text-amber-700 mt-0.5">Payer email differs from this customer — verify ownership.</div>
                             )}
                          </div>
                          <div className="flex items-center gap-3">
                             <div className="text-right">
                               <div className="font-semibold text-green-600">${Number(payment.amount || 0).toFixed(2)}</div>
                               <Badge variant="outline" className="bg-green-100 text-green-700">
                                 {payment.status}
                               </Badge>
                             </div>
                             <Button
                               variant="ghost"
                               size="icon"
                               className="text-blue-600 hover:bg-blue-50"
                               onClick={() => {
                                 setEditPaymentForm({
                                   id: payment.id,
                                   amount: String(payment.amount || ''),
                                   payment_method: payment.payment_method || 'cash',
                                   payment_date: paymentDateInput(payment.payment_date) || localToday(),
                                    payer_name: getPaymentPayerDetails(payment).name,
                                    payer_email: getPaymentPayerDetails(payment).email,
                                   invoice_number: payment.invoice_number || '',
                                   reference_number: payment.reference_number || '',
                                   notes: payment.notes || ''
                                 });
                                 setShowEditPaymentDialog(true);
                               }}
                               title="Edit payment"
                             >
                               <Pencil className="w-4 h-4" />
                             </Button>
                             <Button
                               size="icon"
                               variant="ghost"
                               className="opacity-0 group-hover:opacity-100 transition-opacity text-red-600 hover:bg-red-50"
                               onClick={() => {
                                 if (window.confirm('Delete this payment? This will update the related invoice and remove any matching fee-deduction expense.')) {
                                   deletePaymentMutation.mutate(payment.id);
                                 }
                               }}
                               title="Delete payment"
                               data-testid={`btn-delete-payment-${payment.id}`}
                             >
                               <Trash2 className="w-4 h-4" />
                             </Button>
                           </div>
                        </div>
                      )})}
                      {payments.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                          No payments yet
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="projects" className="mt-0">
              {activeSection === "projects" && (
                <Card>
                  <CardContent className="p-3 sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold">Projects ({projects.length})</h2>
                    </div>
                    <div className="space-y-3">
                      {projects.map((project) => (
                        <div key={project.id} className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer" onClick={() => navigate(createPageUrl('Projects'))}>
                          <div className="flex items-center justify-between">
                            <div className="font-medium">{project.name}</div>
                            <Badge variant="outline">
                              {project.status}
                            </Badge>
                          </div>
                          {project.description && (
                            <div className="text-sm text-gray-500 mt-2">{project.description}</div>
                          )}
                          <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                            {project.start_date && <span>Start: {formatDateOnly(project.start_date)}</span>}
                            {project.deadline && <span>Deadline: {formatDateOnly(project.deadline)}</span>}
                            {project.budget && <span>Budget: ${project.budget.toFixed(2)}</span>}
                          </div>
                        </div>
                      ))}
                      {projects.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                          No projects yet
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="schedule-build" className="mt-0">
              {activeSection === "schedule-build" && (
                <Card>
                  <CardContent className="p-3 sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold">Schedule Build ({builds.length})</h2>
                      <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => {
                        const addr = [customer?.street, customer?.city, customer?.state, customer?.zip].filter(Boolean).join(', ') || customer?.address || customer?.property_address || '';
                        const params = new URLSearchParams({ customerId: customer?.id || '', customerName: customer?.name || '', address: addr });
                        navigate(createPageUrl('BuildSchedule') + '?' + params.toString());
                      }}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Build
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {builds.map((build) => (
                        <div key={build.id} className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer" onClick={() => navigate(createPageUrl('BuildSchedule') + '?editId=' + build.id)}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div>
                                <div className="font-medium">{build.job_type || 'Build'}</div>
                                <div className="text-sm text-gray-500">{formatDateOnly(build.build_date)}</div>
                              </div>
                            </div>
                            <Badge variant="outline">
                              {build.status || 'scheduled'}
                            </Badge>
                          </div>
                          {build.crew && (
                            <div className="text-sm text-gray-500 mt-2">Crew: {build.crew}</div>
                          )}
                          {build.assigned_to && (
                            <div className="text-sm text-gray-500">Assigned to: {build.assigned_to}</div>
                          )}
                        </div>
                      ))}
                      {builds.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                          No scheduled builds yet
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="tasks" className="mt-0">
              {activeSection === "tasks" && (
                <Card>
                  <CardContent className="p-3 sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold">Tasks ({tasks.length})</h2>
                      <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => setShowTaskDialog(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Related Task
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {tasks.map((task) => {
                        const taskBoard = boards.find(b => b.id === task.board_id);
                        const boardColumns = taskBoard?.columns || [
                          { id: 'not_started', name: 'Not Started', color: '#94a3b8' },
                          { id: 'in_progress', name: 'In Progress', color: '#3b82f6' },
                          { id: 'job_completed', name: 'Completed', color: '#10b981' }
                        ];
                        
                        return (
                          <div 
                            key={task.id} 
                            className="flex items-center gap-3 p-4 border rounded-lg hover:bg-gray-50 group cursor-pointer"
                            onClick={() => navigate(createPageUrl('Tasks') + `?task_id=${task.id}`)}
                          >
                            <input 
                              type="checkbox" 
                              checked={task.status === 'job_completed'} 
                              readOnly 
                              className="w-4 h-4"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="flex-1">
                              <div className="font-medium text-blue-600 hover:underline">{task.name}</div>
                              {task.description && <div className="text-sm text-gray-500">{task.description}</div>}
                              {task.due_date && (
                                <div className="text-xs text-gray-400 mt-1">
                                  Due: {format(new Date(task.due_date), 'MMM d, yyyy')}
                                </div>
                              )}
                            </div>
                            <Select
                              value={task.column || 'not_started'}
                              onValueChange={async (newColumn) => {
                                try {
                                  await base44.entities.Task.update(task.id, {
                                    column: newColumn,
                                    status: newColumn === 'job_completed' ? 'job_completed' : 
                                           newColumn === 'not_started' ? 'not_started' : 'in_progress'
                                  });
                                  queryClient.invalidateQueries({ queryKey: ['customer-tasks'] });
                                  queryClient.invalidateQueries({ queryKey: ['tasks'] });
                                  queryClient.invalidateQueries({ queryKey: ['my-assignments-tasks'] });
                                  toast.success('Task moved!');
                                } catch (error) {
                                  toast.error('Failed to move task: ' + error.message);
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <SelectTrigger className="w-40">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {boardColumns.map(col => (
                                  <SelectItem key={col.id} value={col.id}>
                                    {col.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-red-600 hover:bg-red-50"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm('Delete this task? This will remove it from everywhere in the system.')) {
                                  deleteTaskMutation.mutate(task.id);
                                }
                              }}
                              title="Delete task"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        );
                      })}
                      {tasks.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                          No tasks yet
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="communications" className="mt-0">
              {activeSection === "communications" && (
                <div className="space-y-4">
                <CallerMemoryCard
                  companyId={myCompany?.id}
                  phone={customer?.phone || customer?.phone_2}
                  customerId={customer?.id}
                />
                <Card>
                  <CardHeader className="border-b pb-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-lg">Communication History ({communications.length})</CardTitle>
                      <div className="flex items-center gap-2">
                        {isCustomerRepOwned && (
                          <>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                              Alex paused
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                              onClick={handleHandBackToSarahCustomer}
                              disabled={isHandingBackSarah}
                            >
                              {isHandingBackSarah ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RotateCcw className="w-3 h-3 mr-1" />}
                              Hand back to Alex
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowLogCallDialog(true)}
                          data-testid="button-log-call"
                        >
                          <Phone className="w-4 h-4 mr-2" />
                          Log Call
                        </Button>
                        <Button
                          size="sm"
                          className="bg-blue-600 hover:bg-blue-700"
                          onClick={() => setShowSMSDialog(true)}
                        >
                          <Send className="w-4 h-4 mr-2" />
                          Send SMS
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    {communications.length === 0 ? (
                      <div className="text-center py-12 text-gray-500">No communications yet</div>
                    ) : (
                      <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                        {communications.map((comm) => {
                          const type = comm.communication_type || comm.type || 'sms';
                          const isOutbound = comm.direction === 'outbound';
                          const msgText = comm.message || comm.body || comm.subject || '';
                          const ts = comm.created_date || comm.created_at;
                          const sentBy = comm.data?.sent_by || comm.created_by || '';

                          if (type === 'call') {
                            return (
                              <div key={comm.id} className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                                <div className="flex items-center gap-3">
                                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isOutbound ? 'bg-blue-100' : 'bg-green-100'}`}>
                                    <Phone className={`w-4 h-4 ${isOutbound ? 'text-blue-600' : 'text-green-600'}`} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      {isOutbound
                                        ? <ArrowUpRight className="w-3 h-3 text-blue-500" />
                                        : <ArrowDownLeft className="w-3 h-3 text-green-500" />}
                                      <span className="text-sm font-medium text-gray-700">{isOutbound ? 'Outbound Call' : 'Inbound Call'}</span>
                                      {comm.duration_minutes && (
                                        <span className="text-xs text-gray-400">· {Math.round(comm.duration_minutes)} min</span>
                                      )}
                                    </div>
                                    {msgText && <p className="text-xs text-gray-500 truncate mt-0.5">{msgText}</p>}
                                  </div>
                                  <span className="text-xs text-gray-400 flex-shrink-0">
                                    {ts ? format(new Date(ts), 'MMM d, h:mm a') : ''}
                                  </span>
                                </div>
                                {comm.recording_url && (
                                  <audio
                                    controls
                                    src={`/api/recording-proxy?url=${encodeURIComponent(comm.recording_url)}`}
                                    className="w-full mt-2 h-9"
                                    preload="none"
                                  />
                                )}
                              </div>
                            );
                          }

                          if (type === 'email') {
                            return (
                              <div key={comm.id} className="p-3 rounded-lg bg-purple-50 border border-purple-100">
                                <div className="flex items-center justify-between mb-1">
                                  <div className="flex items-center gap-2">
                                    <Mail className="w-4 h-4 text-purple-600" />
                                    <span className="text-sm font-medium text-purple-800">{comm.subject || 'Email'}</span>
                                  </div>
                                  <span className="text-xs text-gray-400">{ts ? format(new Date(ts), 'MMM d, h:mm a') : ''}</span>
                                </div>
                                {msgText && <p className="text-sm text-gray-600 line-clamp-2">{msgText}</p>}
                              </div>
                            );
                          }

                          // SMS / WhatsApp — chat bubble
                          return (
                            <div key={comm.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm ${isOutbound
                                ? 'bg-blue-600 text-white rounded-br-sm'
                                : 'bg-gray-100 text-gray-800 rounded-bl-sm border border-gray-200'}`}
                              >
                                <p className="text-sm leading-relaxed">{msgText || '(no content)'}</p>
                                <div className={`flex items-center gap-1.5 mt-1 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                                  <span className={`text-xs ${isOutbound ? 'text-blue-200' : 'text-gray-400'}`}>
                                    {ts ? format(new Date(ts), 'MMM d, h:mm a') : ''}
                                  </span>
                                  {isOutbound && sentBy && (
                                    <span className="text-xs text-blue-200">· {sentBy}</span>
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
                </div>
              )}
            </TabsContent>

            <TabsContent value="proposals" className="mt-0">
              {activeSection === "proposals" && (
                <Card>
                  <CardContent className="p-3 sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold">Proposals ({proposals.length})</h2>
                      <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => navigate(createPageUrl('Proposals'))}>
                        <Plus className="w-4 h-4 mr-2" />
                        New Proposal
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {proposals.map((proposal) => (
                        <div key={proposal.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 cursor-pointer">
                          <div>
                            <div className="font-medium">{proposal.proposal_number}</div>
                            <div className="text-sm text-gray-600">{proposal.title}</div>
                            <div className="text-xs text-gray-400 mt-1">
                              {proposal.created_date ? format(new Date(proposal.created_date), 'MMM d, yyyy') : ''}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-green-600">${Number(proposal.amount || 0).toFixed(2)}</div>
                            <Badge variant="outline">
                              {proposal.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                      {proposals.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                          No proposals yet
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="contracts" className="mt-0">
              {activeSection === "contracts" && (
                <div className="space-y-6">
                  {/* Signing History */}
                  <Card>
                    <CardContent className="p-3 sm:p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                          <FileSignature className="w-5 h-5 text-blue-600" />
                          Signing History ({signingsessions.length})
                        </h2>
                        <Button
                          size="sm"
                          className="bg-blue-600 hover:bg-blue-700"
                          data-testid="button-send-for-signature-history"
                          onClick={() => {
                            setSignatureSelectedTemplate(null);
                            setSignatureContractForm({ contract_name: "", delivery_method: "email" });
                            setShowSendForSignatureDialog(true);
                          }}
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Send for Signature
                        </Button>
                      </div>
                      {(() => {
                        const signingStatusConfig = {
                          draft:             { label: 'Draft',              color: 'bg-gray-100 text-gray-700 border-gray-300' },
                          signed_by_rep:     { label: 'Signed by Rep',      color: 'bg-blue-100 text-blue-700 border-blue-300' },
                          sent_to_customer:  { label: 'Sent to Customer',   color: 'bg-amber-100 text-amber-700 border-amber-300' },
                          awaiting_customer: { label: 'Awaiting Customer',  color: 'bg-amber-100 text-amber-700 border-amber-300' },
                          completed:         { label: 'Completed',          color: 'bg-green-100 text-green-700 border-green-300' },
                        };
                        return signingsessions.length > 0 ? (
                          <div className="space-y-3">
                            {signingsessions.map((session) => {
                              const cfg = signingStatusConfig[session.status] || { label: session.status, color: 'bg-gray-100 text-gray-700 border-gray-300' };
                              const createdAt = session.created_date || session.created_at;
                              return (
                                <div
                                  key={session.id}
                                  className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                                  data-testid={`row-signing-session-${session.id}`}
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
                        ) : (
                          <div className="text-center py-8 text-gray-500 text-sm">No signing sessions yet</div>
                        );
                      })()}
                    </CardContent>
                  </Card>

                  {/* Legacy Contracts */}
                  <Card>
                    <CardContent className="p-3 sm:p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold">Contracts ({contracts.length})</h2>
                        <Button size="sm" variant="outline" onClick={() => navigate(createPageUrl('Contracts'))}>
                          <Plus className="w-4 h-4 mr-2" />
                          New Contract
                        </Button>
                      </div>
                      <div className="space-y-3">
                        {contracts.map((contract) => (
                          <div key={contract.id} className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">{contract.contract_name}</div>
                              <Badge variant="outline">
                                {contract.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                              <span>Type: {contract.contract_type}</span>
                              {contract.start_date && <span>Start: {format(new Date(contract.start_date), 'MMM d, yyyy')}</span>}
                              {contract.end_date && <span>End: {format(new Date(contract.end_date), 'MMM d, yyyy')}</span>}
                              {contract.value && <span>Value: ${contract.value.toFixed(2)}</span>}
                            </div>
                          </div>
                        ))}
                        {contracts.length === 0 && (
                          <div className="text-center py-8 text-gray-500 text-sm">
                            No contracts yet
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>

            <TabsContent value="calendar" className="mt-0">
              {activeSection === "calendar" && (
                <Card>
                  <CardContent className="p-3 sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold">Calendar Events ({calendarEvents.length})</h2>
                      <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => navigate(createPageUrl('Calendar'))}>
                        <Plus className="w-4 h-4 mr-2" />
                        Schedule Event
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {calendarEvents.map((event) => (
                        <div key={event.id} className="p-4 border rounded-lg hover:bg-gray-50">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium">{event.title}</div>
                              <div className="text-sm text-gray-600 mt-1">
                                {format(new Date(event.start_time), 'MMM d, yyyy h:mm a')}
                              </div>
                              {event.location && <div className="text-xs text-gray-400 mt-1">📍 {event.location}</div>}
                            </div>
                            <Badge variant="outline">
                              {event.event_type}
                            </Badge>
                          </div>
                        </div>
                      ))}
                      {calendarEvents.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                          No calendar events yet
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="files" className="mt-0">
              {activeSection === "files" && (
                <Card>
                  <CardContent className="p-3 sm:p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-xl font-bold flex items-center gap-2">
                        <Folder className="w-5 h-5 text-blue-600" />
                        Files & Photos ({files.length + inspectionMedia.length})
                      </h2>
                      <div className="flex gap-2">
                        {files.some(f => f.file_type?.startsWith('image/') || f.file_type === 'photo') && (
                          <Button
                            onClick={() => {
                              const allImageIds = files
                                .filter(f => (f.file_type?.startsWith('image/') || f.file_type === 'photo') && !isHeicFile(f.document_name))
                                .map(f => f.id);
                              setSelectedFiles(allImageIds.length === selectedFiles.length && selectedFiles.every(id => allImageIds.includes(id)) ? [] : allImageIds);
                            }}
                            variant="outline"
                            className="text-blue-600"
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            {files.filter(f => (f.file_type?.startsWith('image/') || f.file_type === 'photo') && !isHeicFile(f.document_name)).length === selectedFiles.length && selectedFiles.length > 0 ? 'Deselect All' : 'Select All'}
                          </Button>
                        )}
                        {selectedFiles.length > 0 && (
                          <>
                            <Button
                              onClick={handleDownloadSelectedAsPDF}
                              disabled={isGeneratingPDF}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              {isGeneratingPDF ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Creating PDF...
                                </>
                              ) : (
                                <>
                                  <Download className="w-4 h-4 mr-2" />
                                  Download {selectedFiles.length} as PDF
                                </>
                              )}
                            </Button>
                            <BulkDeleteButton
                              onClick={() => setShowBulkDeleteDialog(true)}
                              className="bg-red-600 hover:bg-red-700"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete All
                            </BulkDeleteButton>
                          </>
                        )}
                        <Button onClick={() => setShowFileUpload(true)} className="bg-blue-600 hover:bg-blue-700">
                          <Plus className="w-4 h-4 mr-2" />
                          Upload Files
                        </Button>
                      </div>
                    </div>

                    {showFileUpload && (
                      <div className="mb-6 p-6 bg-blue-50 dark:bg-blue-950/30 border-2 border-blue-200 dark:border-blue-800 rounded-lg">
                        <h3 className="font-semibold mb-4 text-gray-900 dark:text-gray-100">Upload Files (Batch Upload)</h3>
                        <div className="space-y-4">
                          <div>
                            <Label className="text-gray-700 dark:text-gray-200">Select Files * (you can select multiple)</Label>
                            <Input
                              type="file"
                              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,.pdf,.doc,.docx,.xlsx,.pptx,.txt"
                              multiple
                              onChange={(e) => setFileForm({...fileForm, files: Array.from(e.target.files)})}
                            />
                            {fileForm.files.length > 0 && (
                              <div className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                                <p className="font-medium">{fileForm.files.length} file(s) selected:</p>
                                <ul className="list-disc list-inside max-h-20 overflow-y-auto">
                                  {Array.from(fileForm.files).map((file, idx) => (
                                    <li key={idx} className={isHeicFile(file.name) ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>
                                      {file.name} {isHeicFile(file.name) && '⚠️ HEIC - Won\'t display!'}
                                    </li>
                                  ))}
                               </ul>
                                {Array.from(fileForm.files).some(f => isHeicFile(f.name)) && (
                                  <p className="text-red-600 dark:text-red-400 text-xs mt-2">
                                    ⚠️ HEIC files won't display in browsers. Please convert to JPG/PNG first!
                                  </p>
                                )}
                              </div>
                            )}
                            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                              Supported: JPG, PNG, GIF, WebP, PDF, DOC, DOCX, XLSX, TXT (NOT HEIC)
                            </p>
                          </div>

                          <div>
                            <Label className="text-gray-700 dark:text-gray-200">Category *</Label>
                            <div className="flex gap-2 items-start">
                              <Select
                                value={fileForm.category}
                                onValueChange={(v) => {
                                    setFileForm({...fileForm, category: v});
                                    setShowAddCategory(false);
                                }}
                              >
                                <SelectTrigger className="flex-1">
                                  <SelectValue placeholder="Select category" />
                                </SelectTrigger>
                                <SelectContent>
                                  <div className="px-2 py-1.5 border-b sticky top-0 bg-white z-10">
                                    <p className="text-xs font-semibold text-gray-500 uppercase">Default Categories</p>
                                  </div>
                                  {defaultCategories.map(cat => (
                                    <SelectItem key={cat.value} value={cat.value}>
                                      <div className="flex items-center gap-2">
                                        {cat.icon} {cat.label}
                                      </div>
                                    </SelectItem>
                                  ))}
                                  {customCategories.length > 0 && (
                                    <>
                                      <SelectSeparator />
                                      <div className="px-2 py-1.5 border-b sticky top-0 bg-white z-10">
                                        <p className="text-xs font-semibold text-gray-500 uppercase">Custom Categories</p>
                                      </div>
                                      {customCategories.map(cat => (
                                        <SelectItem key={cat.value} value={cat.value}>
                                          <div className="flex items-center gap-2">
                                            {cat.icon} {cat.label}
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </>
                                  )}
                                </SelectContent>
                              </Select>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setShowAddCategory(!showAddCategory)}
                                title="Add or manage custom categories"
                              >
                                <Plus className="w-4 h-4" />
                              </Button>
                            </div>

                            {showAddCategory && (
                              <div className="flex flex-col gap-2 mt-2 p-3 border rounded-md bg-gray-50 dark:bg-gray-900/60">
                                <div className="flex gap-2">
                                  <Input
                                    placeholder="New category name"
                                    value={newCategoryName}
                                    onChange={(e) => setNewCategoryName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleAddCategory();
                                      }
                                    }}
                                  />
                                  <Button onClick={handleAddCategory} size="sm">
                                    Add
                                  </Button>
                                </div>
                                {customCategories.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">Existing Custom Categories:</p>
                                    {customCategories.map(cat => (
                                         <div key={cat.value} className="flex items-center justify-between p-1 pl-2 text-sm bg-white dark:bg-gray-800 rounded-md border">
                                        <span className="flex items-center gap-2">
                                          {cat.icon} {cat.label}
                                        </span>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => handleDeleteCategory(cat.value)}
                                          className="h-6 w-6 p-0 text-red-600"
                                          title={`Delete ${cat.label} category`}
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <div>
                            <Label className="text-gray-700 dark:text-gray-200">Label / Title (optional)</Label>
                            <Input
                              value={fileForm.label}
                              onChange={(e) => setFileForm({...fileForm, label: e.target.value})}
                              placeholder="e.g., Left Elevation - will add numbers if multiple files"
                            />
                          </div>

                          <div>
                            <Label className="text-gray-700 dark:text-gray-200">Notes (optional)</Label>
                            <Textarea
                              value={fileForm.notes}
                              onChange={(e) => setFileForm({...fileForm, notes: e.target.value})}
                              placeholder="Add any notes about these files..."
                              rows={3}
                            />
                          </div>

                          <div className="flex gap-3 justify-end">
                            <Button 
                              variant="outline" 
                              onClick={() => {
                                setShowFileUpload(false);
                                setFileForm({ label: "", category: "", notes: "", files: [] });
                                setShowAddCategory(false);
                              }}
                              disabled={uploadingFile}
                            >
                              Cancel
                            </Button>
                            <Button 
                              onClick={handleFileUpload}
                              disabled={fileForm.files.length === 0 || !fileForm.category || uploadingFile}
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              {uploadingFile ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Uploading {fileForm.files.length} file(s)...
                                </>
                              ) : (
                                <>
                                  <Upload className="w-4 h-4 mr-2" />
                                  Upload {fileForm.files.length > 0 && `(${fileForm.files.length})`}
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}

                    {showEditDialog && editingFile && (
                      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
                        <DialogContent className="max-w-lg">
                          <DialogHeader>
                            <DialogTitle>Edit File Details</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4 pt-4">
                            <div>
                              <Label>File Name *</Label>
                              <Input
                                value={editForm.document_name}
                                onChange={(e) => setEditForm({...editForm, document_name: e.target.value})}
                                placeholder="e.g., Front Elevation 1"
                              />
                            </div>
                            <div>
                              <Label>Category *</Label>
                              <Select
                                value={editForm.category}
                                onValueChange={(v) => setEditForm({...editForm, category: v})}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select category" />
                                </SelectTrigger>
                                <SelectContent>
                                  <div className="px-2 py-1.5 border-b sticky top-0 bg-white z-10">
                                    <p className="text-xs font-semibold text-gray-500 uppercase">Default Categories</p>
                                  </div>
                                  {defaultCategories.map(cat => (
                                    <SelectItem key={cat.value} value={cat.value}>
                                      <div className="flex items-center gap-2">
                                        {cat.icon} {cat.label}
                                      </div>
                                    </SelectItem>
                                  ))}
                                  {customCategories.length > 0 && (
                                    <>
                                      <SelectSeparator />
                                      <div className="px-2 py-1.5 border-b sticky top-0 bg-white z-10">
                                        <p className="text-xs font-semibold text-gray-500 uppercase">Custom Categories</p>
                                      </div>
                                      {customCategories.map(cat => (
                                        <SelectItem key={cat.value} value={cat.value}>
                                          <div className="flex items-center gap-2">
                                            {cat.icon} {cat.label}
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </>
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label>Notes</Label>
                              <Textarea
                                value={editForm.description}
                                onChange={(e) => setEditForm({...editForm, description: e.target.value})}
                                placeholder="Add notes about this file..."
                                rows={4}
                              />
                            </div>
                            <div className="flex justify-end gap-3">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setShowEditDialog(false);
                                  setEditingFile(null);
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                onClick={handleUpdateFile}
                                disabled={updateFileMutation.isPending}
                                className="bg-blue-600 hover:bg-blue-700"
                              >
                                {updateFileMutation.isPending ? (
                                  <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Saving...
                                  </>
                                ) : (
                                  <>
                                    <Save className="w-4 h-4 mr-2" />
                                    Save Changes
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}

                    {Object.keys(filesByCategory).length === 0 && inspectionMedia.length === 0 ? (
                      <div className="text-center py-12 text-gray-500">
                        <Folder className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <p>No files uploaded yet</p>
                        <p className="text-xs mt-2">Click "Upload Files" to add documents or photos.</p>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {Object.entries(allFilesWithInspections).sort(([catA], [catB]) => {
                          if (catA === 'other') return 1;
                          if (catB === 'other') return -1;
                          const labelA = allCategories.find(c => c.value === catA)?.label || catA.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                          const labelB = allCategories.find(c => c.value === catB)?.label || catB.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                          return labelA.localeCompare(labelB);
                        }).map(([category, categoryFiles]) => {
                          const catInfo = allCategories.find(c => c.value === category) || { 
                            label: category.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase()), 
                            icon: "📁",
                            custom: false
                          };
                          const categoryImageFiles = categoryFiles.filter(f => f.file_type?.startsWith('image/') && !isHeicFile(f.document_name));
                          const allCategoryImagesSelected = categoryImageFiles.length > 0 && categoryImageFiles.every(f => selectedFiles.includes(f.id));
                          
                          return (
                            <div key={category} className="border rounded-lg p-4 bg-white">
                              <div className="flex items-center justify-between mb-3">
                                <h3 className="font-semibold flex items-center gap-2">
                                  <span>{catInfo.icon}</span>
                                  <span>{catInfo.label}</span>
                                  <Badge variant="secondary">{categoryFiles.length}</Badge>
                                </h3>
                                <div className="flex gap-2">
                                  {categoryImageFiles.length > 0 && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSelectAllInCategory(categoryFiles);
                                      }}
                                      className="text-blue-600"
                                    >
                                      <CheckCircle className="w-4 h-4 mr-1" />
                                      {allCategoryImagesSelected ? 'Deselect All Photos' : 'Select All Photos'}
                                    </Button>
                                  )}
                                  {catInfo.custom && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteCategory(category)
                                      }}
                                      className="text-red-600 hover:text-red-700"
                                      title={`Delete ${catInfo.label} category`}
                                    >
                                      <Trash2 className="w-4 h-4 mr-1" />
                                      Delete Category
                                    </Button>
                                  )}
                                </div>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {categoryFiles.map((file) => {
                                  const isHeic = isHeicFile(file.document_name);
                                  const isSelected = selectedFiles.includes(file.id);
                                  const isImage = file.file_type?.startsWith('image/') || file.file_type === 'photo';

                                 return (
                                   <div 
                                     key={file.id} 
                                     className={`group relative border rounded-lg overflow-hidden bg-gray-50 hover:shadow-lg transition-shadow duration-200 ${isImage && !isHeic ? 'cursor-pointer' : ''} ${isSelected && isImage && !isHeic ? 'ring-2 ring-blue-500' : ''}`}
                                     onClick={(e) => {
                                       e.stopPropagation();
                                       if (isImage && !isHeic) {
                                         handleFileSelect(file.id);
                                       } else if (!isImage || isHeic) {
                                         setViewingFile(file);
                                       }
                                     }}
                                   >
                                     {isImage && !isHeic && (
                                       <input
                                         type="checkbox"
                                         checked={isSelected}
                                         onChange={(e) => {
                                           e.stopPropagation();
                                           handleFileSelect(file.id);
                                         }}
                                         onClick={(e) => e.stopPropagation()}
                                         className="absolute top-3 left-3 w-5 h-5 cursor-pointer z-20 accent-blue-600"
                                         title="Select for download"
                                       />
                                     )}
                                     {(file.file_type?.startsWith('image/') || file.file_type === 'photo') && !isHeic ? (
                                       imageErrors[file.id] ? (
                                         <div className="w-full h-40 bg-gray-200 flex flex-col items-center justify-center text-gray-500 p-2">
                                           <Image className="w-12 h-12 mb-2" />
                                           <p className="text-xs font-semibold mb-1">Image failed to load</p>
                                           <p className="text-xs text-gray-400 break-all px-2 text-center">
                                             {file.file_url || 'No URL'}
                                           </p>
                                         </div>
                                       ) : (
                                         <img 
                                           src={file.file_url} 
                                           alt={file.document_name}
                                           className="w-full h-40 object-cover hover:opacity-90 transition-opacity"
                                           onError={() => handleImageError(file.id, file.file_url)}
                                           loading="lazy"
                                         />
                                       )
                                     ) : isHeic ? (
                                       <div className="w-full h-40 bg-yellow-100 flex flex-col items-center justify-center text-yellow-800 p-3">
                                         <Image className="w-12 h-12 mb-2" />
                                         <p className="text-xs font-semibold text-center">HEIC Format</p>
                                         <p className="text-xs text-center mt-1">Can't display in browser</p>
                                         <p className="text-xs text-center mt-1">Click to download</p>
                                       </div>
                                     ) : (
                                       <div className="w-full h-40 bg-gray-100 flex items-center justify-center">
                                         <FileText className="w-12 h-12 text-gray-400" />
                                       </div>
                                     )}
                                     <div className="p-3 bg-white">
                                       <p className="font-medium text-sm truncate">{file.document_name}</p>
                                       {file.description && (
                                         <p className="text-xs text-gray-500 mt-1 line-clamp-2">{file.description}</p>
                                       )}
                                       <p className="text-xs text-gray-400 mt-1">
                                         {file.created_date ? format(new Date(file.created_date), 'MMM d, yyyy') : ''}
                                       </p>
                                     </div>
                                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className="bg-white h-7 w-7 p-0"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleEditFile(file);
                                          }}
                                          title="Edit file details"
                                        >
                                          <Pencil className="w-4 h-4" />
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className="bg-white h-7 w-7 p-0"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleDownload(file);
                                          }}
                                          title="Download File"
                                        >
                                          <Download className="w-4 h-4" />
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className="bg-white text-red-600 h-7 w-7 p-0"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (window.confirm('Are you sure you want to delete this file?')) {
                                              deleteFileMutation.mutate(file.id);
                                            }
                                          }}
                                          title="Delete File"
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
              )}
            </TabsContent>

            <TabsContent value="expenses" className="mt-0">
              {activeSection === "expenses" && (
                <Card>
                  <CardContent className="p-3 sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold">Expenses ({customerExpenses.length})</h2>
                      <Button
                        onClick={() => navigate(createPageUrl('Expenses') + `?customer_id=${customer.id}`)}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Expense
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {customerExpenses.map((expense) => (
                        <div key={expense.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                          <div className="flex-1">
                            <div className="font-medium">{expense.vendor_name}</div>
                            <div className="text-sm text-gray-600">{expense.description}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="outline" className="text-xs">
                                {expense.category?.replace(/_/g, ' ')}
                              </Badge>
                              <span className="text-xs text-gray-500">
                                {(expense.expense_date || expense.date) && !isNaN(new Date(expense.expense_date || expense.date).getTime()) ? format(new Date(expense.expense_date || expense.date), 'MMM d, yyyy') : 'No date'}
                              </span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-red-600 text-lg">${Number(expense.amount || 0).toFixed(2)}</div>
                            <div className="text-xs text-gray-500">{expense.payment_method}</div>
                            <div className="flex gap-1 justify-end mt-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-blue-600 hover:bg-blue-50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(createPageUrl('Expenses') + `?expense_id=${expense.id}`);
                                }}
                                title="Edit expense"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-red-600 hover:bg-red-50"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (window.confirm('Delete this expense?')) {
                                    await base44.entities.Expense.delete(expense.id);
                                    queryClient.invalidateQueries({ queryKey: ['customer-expenses'] });
                                    queryClient.invalidateQueries({ queryKey: ['expenses'] });
                                  }
                                }}
                                title="Delete expense"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                      {customerExpenses.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                          <Receipt className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                          <p>No expenses yet</p>
                          <p className="text-xs mt-2">Track expenses related to this customer</p>
                        </div>
                      )}
                    </div>
                    {customerExpenses.length > 0 && (
                      <div className="pt-4 mt-2 border-t flex items-center justify-between">
                        <div className="text-sm text-gray-500">Total expenses</div>
                        <div className="text-xl font-bold text-red-600">${totalExpenses.toFixed(2)}</div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="notes" className="mt-0">
              {activeSection === "notes" && (() => {
                const SOURCE_CONFIG = {
                  manual:         { label: 'Note',         color: 'bg-gray-100 text-gray-700 border-gray-300' },
                  task:           { label: 'Task',         color: 'bg-blue-100 text-blue-700 border-blue-300' },
                  build_schedule: { label: 'Build',        color: 'bg-orange-100 text-orange-700 border-orange-300' },
                  lead:           { label: 'Lead',         color: 'bg-purple-100 text-purple-700 border-purple-300' },
                  inspection:     { label: 'Inspection',   color: 'bg-green-100 text-green-700 border-green-300' },
                  project:        { label: 'Project',      color: 'bg-teal-100 text-teal-700 border-teal-300' },
                  communication:  { label: 'Comm',         color: 'bg-pink-100 text-pink-700 border-pink-300' },
                };

                // Only show legacy JSONB notes when no entity notes exist yet (pre-migration state).
                // Once migration runs, entity notes will be present and legacy notes are hidden.
                const rawLegacyNotes = customer?.customer_notes || [];
                const legacyNotes = customerNoteEntities.length === 0
                  ? rawLegacyNotes.map(n => ({
                      _type: 'legacy',
                      id: n.id,
                      note: n.note,
                      created_at: n.created_at || new Date().toISOString(),
                      created_by: n.created_by,
                      source_type: n.source === 'build_schedule' ? 'build_schedule' : 'manual',
                      source_label: n.source_label || null,
                    }))
                  : [];

                // Exclude source_type='task' entity notes — task comments are expanded
                // directly from task.comments below to avoid duplicates.
                const entityNotes = customerNoteEntities
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

                // Synthetic task activity entries — task itself + all comments expanded
                const taskNotes = tasks.flatMap(t => {
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

                // Synthetic communication activity entries
                const commNotes = communications.map(c => {
                  const type = c.communication_type || c.type || 'sms';
                  const direction = c.direction || 'outbound';
                  const body = c.body || c.message || c.notes || '';
                  return {
                    _type: 'activity',
                    id: `comm-${c.id}`,
                    source_type: 'communication',
                    source_label: type.toUpperCase(),
                    note: body
                      ? `${direction === 'inbound' ? '← Inbound' : '→ Outbound'} ${type.toUpperCase()}: ${body.substring(0, 150)}${body.length > 150 ? '…' : ''}`
                      : `${direction === 'inbound' ? 'Inbound' : 'Outbound'} ${type.toUpperCase()}`,
                    created_at: c.created_date || c.timestamp || c.created_at || new Date().toISOString(),
                    created_by: c.created_by || c.staff_name,
                    created_by_name: c.staff_name || null,
                  };
                });

                const allNotes = [...entityNotes, ...legacyNotes, ...taskNotes, ...commNotes]
                  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

                return (
                  <Card>
                    <CardContent className="p-3 sm:p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold">Activity & Notes ({allNotes.length})</h2>
                        <Button
                          size="sm"
                          onClick={() => { setShowAddNote(true); setNewNoteText(''); }}
                          className="bg-blue-600 hover:bg-blue-700"
                          data-testid="button-add-customer-note"
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
                            data-testid="textarea-new-note"
                          />
                          <div className="flex gap-2 justify-end">
                            <Button size="sm" variant="outline" onClick={() => { setShowAddNote(false); setNewNoteText(''); }}>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="bg-blue-600 hover:bg-blue-700"
                              disabled={addNoteMutation.isPending || !newNoteText.trim()}
                              data-testid="button-save-note"
                              onClick={() => {
                                if (!newNoteText.trim()) return;
                                const staffMember = allCompanyStaff.find(s => s.user_email === user?.email);
                                addNoteMutation.mutate({
                                  customer_id: customer.id,
                                  company_id: customer.company_id,
                                  note: newNoteText.trim(),
                                  source_type: 'manual',
                                  created_by: user?.email,
                                  created_by_name: staffMember?.full_name || staffMember?.name || user?.full_name || user?.email,
                                  created_at: new Date().toISOString(),
                                });
                              }}
                            >
                              {addNoteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                              Save Note
                            </Button>
                          </div>
                        </div>
                      )}

                      <div className="space-y-3">
                        {allNotes.length > 0 ? allNotes.map((note) => {
                          const isEditing = editingNoteId === note.id;
                          const srcConf = SOURCE_CONFIG[note.source_type] || SOURCE_CONFIG.manual;
                          const isManualEntity = note._type === 'entity' && note.source_type === 'manual';
                          const authorName = note.created_by_name ||
                            allCompanyStaff.find(s => s.user_email === note.created_by)?.full_name ||
                            note.created_by;

                          return (
                            <div key={note.id} className="p-4 border rounded-lg bg-gray-50 hover:bg-gray-100 group" data-testid={`note-item-${note.id}`}>
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
                                      {note.created_at && !isNaN(new Date(note.created_at).getTime()) ? format(new Date(note.created_at), 'MMM d, yyyy h:mm a') : 'No date'}
                                    </span>
                                    {authorName && (
                                      <>
                                        <span className="text-xs text-gray-300">•</span>
                                        <span className="text-xs text-gray-500">{authorName}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                {isManualEntity && (
                                  <div className="flex gap-1 flex-shrink-0">
                                    {isEditing ? (
                                      <>
                                        <Button
                                          size="icon" variant="ghost"
                                          className="h-8 w-8 text-green-600 hover:bg-green-50"
                                          disabled={updateNoteMutation.isPending}
                                          onClick={() => {
                                            if (!editedNoteText.trim()) { toast.error('Note cannot be empty'); return; }
                                            updateNoteMutation.mutate({ id: note.id, note: editedNoteText.trim() });
                                          }}
                                          title="Save changes"
                                        >
                                          {updateNoteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
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
                                          disabled={deleteNoteMutation.isPending}
                                          onClick={() => {
                                            if (confirm('Delete this note?')) deleteNoteMutation.mutate(note.id);
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
                        }) : (
                          <div className="text-center py-12 text-gray-500">
                            <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                            <p>No activity yet</p>
                            <p className="text-xs mt-2">Notes, tasks, and communications will appear here</p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
            </TabsContent>

            <TabsContent value="action-items" className="mt-0">
              {activeSection === "action-items" && (
                <div className="space-y-3">
                  {activeCustomerActions.length === 0 ? (
                    <Card>
                      <CardContent className="p-8 text-center">
                        <CheckSquare className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                        <p className="text-gray-500 text-sm">No pending action items for this customer.</p>
                      </CardContent>
                    </Card>
                  ) : (
                    activeCustomerActions.map(item => (
                      <Card key={item.id} className="border-l-4 border-l-orange-500" data-testid={`customer-action-item-${item.id}`}>
                        <CardContent className="p-4">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-gray-900">{item.title}</p>
                            {item.description && <p className="text-xs text-gray-500 mt-1">{item.description}</p>}
                            {item.due_at && (
                              <p className={`text-xs mt-1 ${new Date(item.due_at) < new Date() ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                                {new Date(item.due_at) < new Date() ? 'Overdue' : `Due ${format(new Date(item.due_at), 'MMM d, h:mm a')}`}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2 mt-2">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => completeCustomerActionMutation.mutate(item.id)} data-testid={`complete-customer-action-${item.id}`}>
                              <CheckCircle2 className="w-3 h-3 mr-1" /> Done
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline" className="h-7 text-xs" data-testid={`snooze-customer-action-${item.id}`}>
                                  <Clock className="w-3 h-3 mr-1" /> Snooze
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                {[{ label: '1 hour', h: 1 }, { label: '4 hours', h: 4 }, { label: 'Tomorrow', h: 24 }, { label: '1 week', h: 168 }].map(opt => (
                                  <DropdownMenuItem key={opt.h} onClick={() => { updateCustomerActionMutation.mutate({ id: item.id, data: { status: 'snoozed', snoozed_until: new Date(Date.now() + opt.h * 3600000).toISOString() } }); toast.success(`Snoozed for ${opt.label}`); }}>
                                    {opt.label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { updateCustomerActionMutation.mutate({ id: item.id, data: { assigned_to: user?.email || '' } }); toast.success('Reassigned to you'); }} data-testid={`reassign-customer-action-${item.id}`}>
                              <UserPlus className="w-3 h-3 mr-1" /> Reassign
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="reminders" className="mt-0">
              {activeSection === "reminders" && (() => {
                const now = new Date();
                const upcoming = calendarEvents
                  .filter(e => new Date(e.start_time) >= now)
                  .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
                const past = calendarEvents
                  .filter(e => new Date(e.start_time) < now)
                  .sort((a, b) => new Date(b.start_time) - new Date(a.start_time))
                  .slice(0, 5);

                const getReminderStatus = (start) => {
                  const hoursUntil = (start - now) / 3600000;
                  return [
                    { label: '24h', sent: hoursUntil <= 24, active: hoursUntil > 24 },
                    { label: '6h',  sent: hoursUntil <= 6,  active: hoursUntil > 6 && hoursUntil <= 24 },
                    { label: '1h',  sent: hoursUntil <= 1,  active: hoursUntil > 1 && hoursUntil <= 6 },
                  ];
                };

                return (
                  <div className="space-y-5">
                    {/* Policy info */}
                    <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-purple-50">
                      <CardContent className="p-4 flex items-center gap-4">
                        <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <Bell className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 text-sm">Automatic Appointment Reminders</p>
                          <p className="text-xs text-gray-600 mt-0.5">
                            This customer receives an <strong>email + SMS</strong> reminder automatically at
                            <strong> 24 hours</strong>, <strong>6 hours</strong>, and <strong>1 hour</strong> before each appointment.
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Upcoming appointments */}
                    <Card>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-blue-600" />
                            Upcoming Appointments ({upcoming.length})
                          </CardTitle>
                          <Button
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={() => {
                              const today = new Date();
                              const dd = String(today.getFullYear()) + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
                              setNewApptForm(f => ({ ...f, date: dd, title: `Appointment – ${customer?.name || ''}` }));
                              setShowNewAppointmentDialog(true);
                            }}
                            data-testid="button-schedule-appointment"
                          >
                            <Plus className="w-4 h-4 mr-1" />
                            Schedule
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {upcoming.length === 0 ? (
                          <div className="text-center py-10">
                            <Calendar className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                            <p className="text-gray-500 text-sm">No upcoming appointments for this customer.</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {upcoming.map((evt) => {
                              const start = new Date(evt.start_time);
                              const hoursUntil = Math.round((start - now) / 3600000);
                              const reminders = getReminderStatus(start);
                              return (
                                <div key={evt.id} data-testid={`reminder-event-${evt.id}`}
                                     className="border rounded-lg p-4 hover:shadow-sm transition-shadow">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                      <p className="font-semibold text-gray-900">{evt.title}</p>
                                      {evt.description && (
                                        <p className="text-xs text-gray-500 mt-0.5">{evt.description}</p>
                                      )}
                                      <div className="flex flex-wrap gap-2 mt-2">
                                        <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-0.5">
                                          <Calendar className="w-3 h-3" />
                                          {format(start, "EEE, MMM d, yyyy")}
                                        </span>
                                        <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-0.5">
                                          <Bell className="w-3 h-3" />
                                          {format(start, "h:mm a")}
                                        </span>
                                        {evt.location && (
                                          <span className="text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-0.5">
                                            📍 {evt.location}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ${
                                      hoursUntil <= 1  ? 'bg-red-100 text-red-700' :
                                      hoursUntil <= 6  ? 'bg-orange-100 text-orange-700' :
                                      hoursUntil <= 24 ? 'bg-yellow-100 text-yellow-700' :
                                                         'bg-blue-100 text-blue-700'
                                    }`}>
                                      {hoursUntil <= 1 ? '< 1h away' :
                                       hoursUntil < 24 ? `${hoursUntil}h away` :
                                       `${Math.round(hoursUntil / 24)}d away`}
                                    </span>
                                  </div>
                                  <div className="mt-3 pt-3 border-t flex items-center gap-2 flex-wrap">
                                    <span className="text-xs text-gray-400">Reminders:</span>
                                    {reminders.map((r) => (
                                      <span key={r.label} className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                        r.sent    ? 'bg-green-100 text-green-700' :
                                        r.active  ? 'bg-orange-100 text-orange-700' :
                                                    'bg-gray-100 text-gray-500'
                                      }`}>
                                        {r.label} {r.sent ? '✓ sent' : r.active ? '⏳ next' : 'pending'}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Past appointments */}
                    {past.length > 0 && (
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2 text-gray-600">
                            <CheckCircle className="w-4 h-4" />
                            Recent Past Appointments
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {past.map((evt) => (
                              <div key={evt.id} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-0">
                                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                                <span className="font-medium text-gray-800 flex-1">{evt.title}</span>
                                <span className="text-gray-400 text-xs">
                                  {format(new Date(evt.start_time), "MMM d, yyyy")}
                                </span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                );
              })()}

              {/* New Appointment Dialog */}
              <Dialog open={showNewAppointmentDialog} onOpenChange={setShowNewAppointmentDialog}>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-blue-600" />
                      Schedule Appointment
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-1">
                    <div>
                      <Label className="text-sm font-medium">Title</Label>
                      <Input
                        className="mt-1"
                        value={newApptForm.title}
                        onChange={e => setNewApptForm(f => ({ ...f, title: e.target.value }))}
                        placeholder="e.g. Roof Inspection"
                        data-testid="input-appt-title"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-sm font-medium">Date</Label>
                        <Input
                          type="date"
                          className="mt-1"
                          value={newApptForm.date}
                          onChange={e => setNewApptForm(f => ({ ...f, date: e.target.value }))}
                          data-testid="input-appt-date"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Time</Label>
                        <Input
                          type="time"
                          className="mt-1"
                          value={newApptForm.time}
                          onChange={e => setNewApptForm(f => ({ ...f, time: e.target.value }))}
                          data-testid="input-appt-time"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Type</Label>
                      <Select value={newApptForm.event_type} onValueChange={v => setNewApptForm(f => ({ ...f, event_type: v }))}>
                        <SelectTrigger className="mt-1" data-testid="select-appt-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="appointment">Appointment</SelectItem>
                          <SelectItem value="inspection">Inspection</SelectItem>
                          <SelectItem value="estimate">Estimate</SelectItem>
                          <SelectItem value="roofing_contractor">Roofing / Install</SelectItem>
                          <SelectItem value="check_pickup">Check Pickup</SelectItem>
                          <SelectItem value="follow_up">Follow Up</SelectItem>
                          <SelectItem value="call">Call</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Location <span className="text-gray-400 font-normal">(optional)</span></Label>
                      <Input
                        className="mt-1"
                        value={newApptForm.location}
                        onChange={e => setNewApptForm(f => ({ ...f, location: e.target.value }))}
                        placeholder={customer?.address || 'Address or location'}
                        data-testid="input-appt-location"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Notes <span className="text-gray-400 font-normal">(optional)</span></Label>
                      <Textarea
                        className="mt-1"
                        rows={2}
                        value={newApptForm.description}
                        onChange={e => setNewApptForm(f => ({ ...f, description: e.target.value }))}
                        placeholder="Any additional details…"
                        data-testid="textarea-appt-notes"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end pt-2">
                    <Button variant="outline" onClick={() => setShowNewAppointmentDialog(false)}>Cancel</Button>
                    <Button
                      className="bg-blue-600 hover:bg-blue-700"
                      disabled={!newApptForm.title.trim() || !newApptForm.date || createAppointmentMutation.isPending}
                      onClick={() => createAppointmentMutation.mutate(newApptForm)}
                      data-testid="button-confirm-appointment"
                    >
                      {createAppointmentMutation.isPending ? 'Scheduling…' : 'Schedule Appointment'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </TabsContent>

            <TabsContent value="crewcam" className="mt-0">
              {activeSection === "crewcam" && (
                <Card>
                  <CardContent className="p-3 sm:p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h2 className="text-xl font-bold flex items-center gap-2">
                          <Camera className="w-5 h-5 text-blue-600" />
                          PhotoSync Inspections
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">Assign and track roof inspection jobs for this customer</p>
                      </div>
                      <Button onClick={() => setIsNewInspectionOpen(true)} className="bg-blue-600 hover:bg-blue-700">
                        <Camera className="w-4 h-4 mr-2" />
                        New Inspection
                      </Button>
                    </div>
                    {inspectionJobs.length === 0 ? (
                      <div className="text-center py-12 text-gray-500">
                        <Camera className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <p className="font-medium">No PhotoSync jobs yet</p>
                        <p className="text-sm mt-1">Create an inspection assignment for this customer</p>
                        <Button onClick={() => setIsNewInspectionOpen(true)} className="mt-4 bg-blue-600 hover:bg-blue-700">
                          <Camera className="w-4 h-4 mr-2" />
                          Create First Inspection
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {inspectionJobs.map(job => {
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
              )}
            </TabsContent>

            <TabsContent value="crew-photos" className="mt-0">
              {activeSection === "crew-photos" && (
                <Card>
                  <CardContent className="p-3 sm:p-6">
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h2 className="text-xl font-bold flex items-center gap-2">
                          <Image className="w-5 h-5 text-orange-500" />
                          Crew Photos
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                          Photos uploaded by your crew via the shareable link
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {crewPhotos.length > 0 && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              data-testid="button-download-all-crew-photos"
                              title="Download every crew photo as one ZIP, regardless of the selected filter"
                              disabled={isDownloadingCrewPhotos}
                              onClick={downloadAllCrewPhotos}
                            >
                              {isDownloadingCrewPhotos
                                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                : <Download className="w-4 h-4 mr-2" />}
                              {isDownloadingCrewPhotos
                                ? `Preparing ${crewPhotoDownloadProgress.completed}/${crewPhotoDownloadProgress.total}`
                                : `Download All (${crewPhotos.length})`}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              data-testid="button-send-photos-to-customer"
                              onClick={() => { setSendPhotosOpen(true); setSelectedPhotoIds(new Set()); setSendPhotosMsg(''); }}
                            >
                              <Mail className="w-4 h-4 mr-2" />
                              Send to Customer
                            </Button>
                          </>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="button-copy-crew-link-photos-tab"
                          onClick={copyCrewUploadLink}
                        >
                          <Upload className="w-4 h-4 mr-2" />
                          Copy Upload Link
                        </Button>
                      </div>
                    </div>

                    <CrewPhotoSharing customer={customer} companyId={myCompany?.id} photos={crewPhotos}
                      sharing={crewPhotoSharing} onSendPortal={() => setShowPortalDialog(true)} />

                    {crewPhotosLoading ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {Array.from({ length: 12 }).map((_, i) => (
                          <div key={i} className="aspect-square rounded-lg bg-gray-200 animate-pulse" />
                        ))}
                      </div>
                    ) : crewPhotos.length === 0 ? (
                      <div className="text-center py-16 text-gray-500">
                        <Image className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                        <p className="font-medium text-lg">No crew photos yet</p>
                        <p className="text-sm mt-1 max-w-xs mx-auto">Share the upload link with your crew so they can send photos directly from WhatsApp.</p>
                        <Button
                          className="mt-4 bg-orange-500 hover:bg-orange-600 text-white"
                          data-testid="button-copy-crew-link-empty"
                          onClick={copyCrewUploadLink}
                        >
                          <Upload className="w-4 h-4 mr-2" />
                          Copy Crew Upload Link
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 mb-4">
                          {[
                            { key: 'all', label: 'All', count: crewPhotos.length },
                            { key: 'whatsapp_upload', label: 'WhatsApp', count: crewPhotos.filter(p => p.source === 'whatsapp_upload').length },
                            { key: 'crew_upload', label: 'Standard Upload', count: crewPhotos.filter(p => p.source === 'crew_upload').length },
                          ].map(({ key, label, count }) => (
                            <button
                              key={key}
                              data-testid={`crew-photo-filter-${key}`}
                              onClick={() => { setCrewPhotoFilter(key); if (customerId) localStorage.setItem(`crewPhotoFilter_${customerId}`, key); }}
                              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                                crewPhotoFilter === key
                                  ? 'bg-orange-500 border-orange-500 text-white'
                                  : 'bg-white border-gray-200 text-gray-600 hover:border-orange-300 hover:text-orange-600'
                              }`}
                            >
                              {label} ({count})
                            </button>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                          {crewPhotos.filter(photo =>
                            crewPhotoFilter === 'all' ? true : photo.source === crewPhotoFilter
                          ).map((photo) => {
                            const url = photo.file_url || photo.url;
                            const date = photo.created_at || photo.created_date;
                            const isHighlighted = !!photo.is_highlighted;
                            return (
                              <div
                                key={photo.id}
                                className={`group relative aspect-square rounded-lg overflow-hidden bg-gray-100 cursor-pointer border transition-colors ${isHighlighted ? 'border-yellow-400 ring-2 ring-yellow-300' : 'hover:border-orange-400'}`}
                                onClick={() => setViewingCrewPhoto({ id: photo.id, url, caption: photo.caption, date, source: photo.source, uploaded_by_name: photo.uploaded_by_name, is_highlighted: isHighlighted })}
                                data-testid={`crew-photo-${photo.id}`}
                              >
                                <img
                                  src={url}
                                  alt={photo.caption || 'Crew photo'}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                  onError={(e) => { e.target.style.display = 'none'; }}
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-end">
                                  <div className="w-full p-2 bg-gradient-to-t from-black/70 to-transparent">
                                    {photo.caption && <p className="text-white text-xs truncate font-medium">{photo.caption}</p>}
                                    {date && <p className="text-gray-200 text-xs">{new Date(date).toLocaleDateString()}</p>}
                                  </div>
                                 <span className="absolute bottom-0 left-0 max-w-full truncate rounded-tr bg-white/95 px-2 py-1 text-[10px] font-medium">
                                   {crewPhotoSharing.isError ? 'Sharing status unavailable' : !crewPhotoSharing.data ? 'Checking sharing…'
                                     : crewPhotoSharing.data.shares?.some(s => s.source_media_id === photo.id && s.is_public)
                                       ? 'Shared with homeowner' : 'Not shared on portal'}
                                 </span>
                                </div>

                                {/* Action buttons — visible on hover */}
                                <div className="absolute top-1 left-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    className={`w-7 h-7 rounded-full shadow-md flex items-center justify-center transition-colors ${isHighlighted ? 'bg-yellow-400 text-white' : 'bg-black/60 text-white hover:bg-yellow-400'}`}
                                    title={isHighlighted ? 'Remove highlight' : 'Highlight photo'}
                                    data-testid={`button-highlight-photo-${photo.id}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      highlightCrewPhotoMutation.mutate({ photoId: photo.id, highlighted: !isHighlighted });
                                    }}
                                  >
                                    <Star className={`w-3.5 h-3.5 ${isHighlighted ? 'fill-white' : ''}`} />
                                  </button>
                                  <button
                                    className="w-7 h-7 rounded-full bg-black/60 text-white hover:bg-red-500 shadow-md flex items-center justify-center transition-colors"
                                    title="Delete photo"
                                    data-testid={`button-delete-photo-${photo.id}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (window.confirm('Delete this photo? This cannot be undone.')) {
                                        deleteCrewPhotoMutation.mutate(photo.id);
                                      }
                                    }}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {/* Source badge — top right */}
                                <div className="absolute top-1 right-1">
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        {photo.source === 'whatsapp_upload' ? (
                                          <span
                                            className="flex items-center justify-center w-6 h-6 rounded-full bg-green-500 shadow-md cursor-default"
                                            data-testid={`crew-photo-source-badge-${photo.id}`}
                                          >
                                            <SiWhatsapp className="w-3.5 h-3.5 text-white" />
                                          </span>
                                        ) : (
                                          <span
                                            className="flex items-center justify-center w-6 h-6 rounded-full bg-orange-500 shadow-md cursor-default"
                                            data-testid={`crew-photo-source-badge-${photo.id}`}
                                          >
                                            <Upload className="w-3 h-3 text-white" />
                                          </span>
                                        )}
                                      </TooltipTrigger>
                                      <TooltipContent side="left" className="text-xs max-w-[160px]">
                                        <p className="font-medium">{photo.source === 'whatsapp_upload' ? 'WhatsApp' : 'Crew Upload'}</p>
                                        {photo.uploaded_by_name && <p className="text-gray-300">{photo.uploaded_by_name}</p>}
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>

                                {/* Highlighted badge */}
                                {isHighlighted && (
                                  <div className="absolute bottom-6 right-1">
                                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-yellow-400 shadow-md">
                                      <Star className="w-3 h-3 text-white fill-white" />
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {(() => {
                          const filteredCount = crewPhotoFilter === 'all' ? crewPhotos.length : crewPhotos.filter(p => p.source === crewPhotoFilter).length;
                          return (
                            <p className="text-sm text-gray-400 mt-4 text-right" data-testid="crew-photo-count">
                              {filteredCount} photo{filteredCount !== 1 ? 's' : ''}
                              {crewPhotoFilter !== 'all' && <span className="ml-1 text-gray-300">of {crewPhotos.length} total</span>}
                            </p>
                          );
                        })()}
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="commissions" className="mt-0">
              {activeSection === "commissions" && (
                <Card>
                  <CardContent className="p-3 sm:p-6 space-y-6">
                    <h2 className="text-xl font-bold">Commission Summary</h2>
                    <CommissionSummary
                      invoices={invoices}
                      staffProfiles={staffProfiles}
                      payouts={payouts}
                      companyId={myCompany?.id}
                      customerId={customer?.id}
                      customerName={customer?.name}
                      customer={customer}
                      onPayoutCreated={() => queryClient.invalidateQueries({ queryKey: ['all-payouts', myCompany?.id] })}
                    />
                    
                    {payouts.filter(p => p.payout_type === 'commission').length > 0 && (
                      <div>
                        <h3 className="font-semibold mb-3">Commission Payouts</h3>
                        <div className="space-y-3">
                          {payouts
                            .filter(p => p.payout_type === 'commission')
                            .map(payout => (
                              <div key={payout.id} className="p-4 border rounded-lg hover:bg-gray-50">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="font-medium">{payout.recipient_name}</div>
                                    <div className="text-sm text-gray-500">{payout.description}</div>
                                    <Badge variant="outline" className={payout.status === 'completed' ? 'bg-green-100 text-green-700 mt-2' : 'bg-yellow-100 text-yellow-700 mt-2'}>
                                      {payout.status}
                                    </Badge>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-xl font-bold text-green-600">${Number(payout.amount || 0).toFixed(2)}</div>
                                    {payout.payment_date && (
                                      <div className="text-xs text-gray-500">
                                        Paid: {format(new Date(payout.payment_date), 'MMM d, yyyy')}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="documents" className="mt-0">
              {activeSection === "documents" && (
                <div className="space-y-6">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <Card className="border-blue-200 bg-blue-50">
                      <CardContent className="p-4">
                        <div className="text-xs text-blue-700 font-medium">Estimates</div>
                        <div className="text-2xl font-bold text-blue-600">{estimates.length}</div>
                      </CardContent>
                    </Card>
                    <Card className="border-green-200 bg-green-50">
                      <CardContent className="p-4">
                        <div className="text-xs text-green-700 font-medium">Invoices</div>
                        <div className="text-2xl font-bold text-green-600">{invoices.length}</div>
                      </CardContent>
                    </Card>
                    <Card className="border-purple-200 bg-purple-50">
                      <CardContent className="p-4">
                        <div className="text-xs text-purple-700 font-medium">Proposals</div>
                        <div className="text-2xl font-bold text-purple-600">{proposals.length}</div>
                      </CardContent>
                    </Card>
                    <Card className="border-orange-200 bg-orange-50">
                      <CardContent className="p-4">
                        <div className="text-xs text-orange-700 font-medium">Contracts</div>
                        <div className="text-2xl font-bold text-orange-600">{contracts.length}</div>
                      </CardContent>
                    </Card>
                    <Card className="border-gray-200 bg-gray-50">
                      <CardContent className="p-4">
                        <div className="text-xs text-gray-700 font-medium">Files</div>
                        <div className="text-2xl font-bold text-gray-600">{files.length}</div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Estimates */}
                  <Card>
                    <CardHeader className="bg-blue-50">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <FileText className="w-5 h-5 text-blue-600" />
                          Estimates ({estimates.length})
                        </CardTitle>
                        <Button size="sm" onClick={() => navigate(createPageUrl('Estimates'))} variant="outline">
                          View All
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4">
                      {groupedEstimates.length > 0 ? (
                        <div className="space-y-2">
                          {groupedEstimates.slice(0, 7).map(estimate => (
                            <div 
                              key={estimate.id} 
                              className={`flex items-center justify-between p-3 border rounded hover:bg-gray-50 cursor-pointer ${estimate._isSupplement ? 'ml-4 border-l-2 border-l-orange-300 bg-orange-50/30' : ''}`}
                              onClick={() => navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.id)}
                            >
                              <div>
                                <div className="font-medium flex items-center gap-1.5">
                                  {estimate._isSupplement && (
                                    <>
                                      <span className={`text-xs font-semibold ${isChangeOrder(estimate) ? 'text-purple-500' : 'text-orange-500'}`}>↳</span>
                                      <ChangeOrderBadge estimate={estimate} />
                                    </>
                                  )}
                                  {estimate.estimate_number}
                                </div>
                                {estimate._isSupplement && estimate.supplement_of_number && (
                                  <div className={`text-xs ${isChangeOrder(estimate) ? 'text-purple-600' : 'text-orange-600'}`}>
                                    {isChangeOrder(estimate) ? 'Change order to' : 'Supplement of'} {estimate.supplement_of_number}
                                  </div>
                                )}
                                <div className="text-xs text-gray-500">{format(new Date(estimate.created_date), 'MMM d, yyyy')}</div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-right">
                                  <div className={`font-semibold ${estimate._isSupplement ? 'text-orange-600' : 'text-blue-600'}`}>${Number(estimate.amount || 0).toFixed(2)}</div>
                                  <Badge variant="outline" className="text-xs">{estimate.status}</Badge>
                                </div>
                                <Button size="icon" variant="ghost" onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(estimate.file_url || createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.id, '_blank');
                                }}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                          {groupedEstimates.length > 7 && (
                            <Button variant="link" className="w-full" onClick={() => setActiveSection('estimates')}>
                              View all {estimates.length} estimates →
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="text-center py-6 text-gray-500 text-sm">No estimates</div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Invoices */}
                  <Card>
                    <CardHeader className="bg-green-50">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <Receipt className="w-5 h-5 text-green-600" />
                          Invoices ({invoices.length})
                        </CardTitle>
                        <Button size="sm" onClick={() => navigate(createPageUrl('Invoices'))} variant="outline">
                          View All
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4">
                      {invoices.length > 0 ? (
                        <div className="space-y-2">
                          {invoices.slice(0, 5).map(invoice => (
                            <div 
                              key={invoice.id} 
                              className="flex items-center justify-between p-3 border rounded hover:bg-gray-50 cursor-pointer"
                              onClick={() => navigate(createPageUrl('invoice-details') + '?id=' + invoice.id)}
                            >
                              <div>
                                <div className="font-medium">{invoice.invoice_number}</div>
                                <div className="text-xs text-gray-500">Due: {invoice.due_date ? formatDateOnly(invoice.due_date) : 'N/A'}</div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-right">
                                  <div className="font-semibold text-green-600">${Number(invoice.amount || 0).toFixed(2)}</div>
                                  <Badge variant="outline" className="text-xs">{invoice.status}</Badge>
                                </div>
                                <Button size="icon" variant="ghost" onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(createPageUrl('invoice-details') + '?id=' + invoice.id);
                                }}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                          {invoices.length > 5 && (
                            <Button variant="link" className="w-full" onClick={() => setActiveSection('invoices')}>
                              View all {invoices.length} invoices →
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="text-center py-6 text-gray-500 text-sm">No invoices</div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Proposals */}
                  <Card>
                    <CardHeader className="bg-purple-50">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <FileSignature className="w-5 h-5 text-purple-600" />
                          Proposals ({proposals.length})
                        </CardTitle>
                        <Button size="sm" onClick={() => navigate(createPageUrl('Proposals'))} variant="outline">
                          View All
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4">
                      {proposals.length > 0 ? (
                        <div className="space-y-2">
                          {proposals.slice(0, 5).map(proposal => (
                            <div key={proposal.id} className="flex items-center justify-between p-3 border rounded hover:bg-gray-50">
                              <div>
                                <div className="font-medium">{proposal.proposal_number}</div>
                                <div className="text-xs text-gray-500">{proposal.title}</div>
                              </div>
                              <div className="text-right">
                                <div className="font-semibold text-purple-600">${Number(proposal.amount || 0).toFixed(2)}</div>
                                <Badge variant="outline" className="text-xs">{proposal.status}</Badge>
                              </div>
                            </div>
                          ))}
                          {proposals.length > 5 && (
                            <Button variant="link" className="w-full" onClick={() => setActiveSection('proposals')}>
                              View all {proposals.length} proposals →
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="text-center py-6 text-gray-500 text-sm">No proposals</div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Contracts */}
                  <Card>
                    <CardHeader className="bg-orange-50">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <FileSignature className="w-5 h-5 text-orange-600" />
                          Contracts ({contracts.length})
                        </CardTitle>
                        <Button size="sm" onClick={() => navigate(createPageUrl('Contracts'))} variant="outline">
                          View All
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4">
                      {contracts.length > 0 ? (
                        <div className="space-y-2">
                          {contracts.slice(0, 5).map(contract => (
                            <div key={contract.id} className="flex items-center justify-between p-3 border rounded hover:bg-gray-50">
                              <div>
                                <div className="font-medium">{contract.contract_name}</div>
                                <div className="text-xs text-gray-500">Type: {contract.contract_type}</div>
                              </div>
                              <Badge variant="outline" className="text-xs">{contract.status}</Badge>
                            </div>
                          ))}
                          {contracts.length > 5 && (
                            <Button variant="link" className="w-full" onClick={() => setActiveSection('contracts')}>
                              View all {contracts.length} contracts →
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="text-center py-6 text-gray-500 text-sm">No contracts</div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Files & Photos */}
                  <Card>
                    <CardHeader className="bg-gray-50">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <Image className="w-5 h-5 text-gray-600" />
                          Files & Photos ({files.length})
                        </CardTitle>
                        <Button size="sm" onClick={() => setActiveSection('files')} variant="outline">
                          View All
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4">
                      {files.length > 0 ? (
                        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                          {files.slice(0, 10).map(file => (
                            <div 
                              key={file.id} 
                              className="relative aspect-square border rounded-lg overflow-hidden hover:shadow-md cursor-pointer"
                              onClick={() => setViewingFile(file)}
                            >
                              {file.file_type?.startsWith('image/') && !isHeicFile(file.document_name) ? (
                                <img 
                                  src={file.file_url} 
                                  alt={file.document_name}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                                  <FileText className="w-8 h-8 text-gray-400" />
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-6 text-gray-500 text-sm">No files</div>
                      )}
                      {files.length > 10 && (
                        <Button variant="link" className="w-full mt-4" onClick={() => setActiveSection('files')}>
                          View all {files.length} files →
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>

            <TabsContent value="estimates" className="mt-0">
              {activeSection === "estimates" && (
                <Card>
                  <CardContent className="p-3 sm:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          className="w-4 h-4 cursor-pointer"
                          checked={selectedEstimateIds.size === groupedEstimates.length && groupedEstimates.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedEstimateIds(new Set(groupedEstimates.map(est => est.id)));
                            } else {
                              setSelectedEstimateIds(new Set());
                            }
                          }}
                          title="Select all"
                        />
                        <h2 className="text-xl font-bold">Estimates ({estimates.length})</h2>
                      </div>
                      <div className="flex items-center gap-2">
                        {groupedEstimates.some(e => /^Estimate\s+-?\d/.test(e.estimate_number || '')) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-orange-600 border-orange-300 hover:bg-orange-50 text-xs"
                            onClick={() => {
                              const importedIds = groupedEstimates
                                .filter(e => /^Estimate\s+-?\d/.test(e.estimate_number || ''))
                                .map(e => e.id);
                              setSelectedEstimateIds(new Set(importedIds));
                            }}
                          >
                            Select imported ({groupedEstimates.filter(e => /^Estimate\s+-?\d/.test(e.estimate_number || '')).length})
                          </Button>
                        )}
                      </div>
                      {selectedEstimateIds.size > 0 && (
                        <BulkDeleteButton
                          variant="destructive"
                          size="sm"
                          disabled={isDeletingEstimates}
                          onClick={async () => {
                            if (!window.confirm(`Delete ${selectedEstimateIds.size} estimate(s)? This cannot be undone.`)) return;
                            setIsDeletingEstimates(true);
                            try {
                              await base44.entities.Estimate.bulkDelete(Array.from(selectedEstimateIds));
                              setSelectedEstimateIds(new Set());
                              queryClient.invalidateQueries({ queryKey: ['customer-estimates'] });
                              queryClient.invalidateQueries({ queryKey: ['estimates'] });
                              toast.success('Estimates deleted');
                            } catch (error) {
                              toast.error(error.message);
                            } finally {
                              setIsDeletingEstimates(false);
                            }
                          }}
                        >
                          {isDeletingEstimates ? 'Deleting…' : `Delete ${selectedEstimateIds.size} selected`}
                        </BulkDeleteButton>
                      )}
                    </div>
                    <div className="space-y-3">
                      {groupedEstimates.map((estimate) => (
                        <div
                          key={estimate.id}
                          className={`flex items-center gap-3 justify-between p-4 border rounded-lg hover:bg-gray-50 group ${estimate._isSupplement ? 'ml-6 border-l-2 border-l-orange-300 bg-orange-50/30' : ''} ${selectedEstimateIds.has(estimate.id) ? 'bg-red-50 border-red-200' : ''}`}
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 flex-shrink-0 cursor-pointer"
                            checked={selectedEstimateIds.has(estimate.id)}
                            onChange={(e) => {
                              const next = new Set(selectedEstimateIds);
                              if (e.target.checked) next.add(estimate.id); else next.delete(estimate.id);
                              setSelectedEstimateIds(next);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="flex-1 cursor-pointer" onClick={() => navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.id)}>
                            <div className="font-medium flex items-center gap-2">
                              {estimate._isSupplement && (
                                <>
                                  <span className={`text-xs font-semibold ${isChangeOrder(estimate) ? 'text-purple-500' : 'text-orange-500'}`}>↳</span>
                                  <ChangeOrderBadge estimate={estimate} />
                                </>
                              )}
                              {estimate.estimate_number}
                              {estimate._isSupplement && estimate.supplement_of_number && (
                                <span className={`text-xs font-normal ${isChangeOrder(estimate) ? 'text-purple-600' : 'text-orange-600'}`}>
                                  — {isChangeOrder(estimate) ? 'Change order to' : 'Supplement of'} {estimate.supplement_of_number}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-gray-500">
                              {estimate.created_date ? format(new Date(estimate.created_date), 'MMM d, yyyy') : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className={`font-semibold ${estimate._isSupplement ? 'text-orange-600' : 'text-green-600'}`}>${Number(estimate.amount || 0).toFixed(2)}</div>
                              <Badge variant="outline" className={
                                estimate.status === 'accepted' ? 'bg-green-100 text-green-700' :
                                estimate.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                                estimate.status === 'declined' ? 'bg-red-100 text-red-700' :
                                'bg-gray-100 text-gray-700'
                              }>
                                {estimate.status}
                              </Badge>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-red-600 hover:bg-red-50"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (window.confirm(`Delete estimate ${estimate.estimate_number}?\n\nThis action cannot be undone.`)) {
                                  try {
                                    await base44.entities.Estimate.delete(estimate.id);
                                    queryClient.invalidateQueries({ queryKey: ['customer-estimates'] });
                                    queryClient.invalidateQueries({ queryKey: ['estimates'] });
                                    toast.success('Estimate deleted');
                                  } catch (error) {
                                    toast.error('Failed to delete: ' + error.message);
                                  }
                                }
                              }}
                              title="Delete estimate"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      {estimates.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                          No estimates yet
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="material-lists" className="mt-0">
              {activeSection === "material-lists" && (
                <Card>
                  <CardContent className="p-3 sm:p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-xl font-bold flex items-center gap-2">
                        <ShoppingCart className="w-5 h-5 text-green-600" />
                        Material Lists ({materialLists.length})
                      </h2>
                    </div>
                    {materialLists.length === 0 ? (
                      <div className="text-center py-12 text-gray-500">
                        <ShoppingCart className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                        <p className="font-medium">No material lists yet</p>
                        <p className="text-sm mt-1">Generate a material list from any estimate to see it here.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {[...materialLists].sort((a, b) => new Date(b.generated_at || b.created_date) - new Date(a.generated_at || a.created_date)).map(ml => (
                          <div key={ml.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-gray-900">{ml.estimate_number || 'Estimate'}</span>
                                  {ml.property_address && (
                                    <span className="text-sm text-gray-500 truncate">{ml.property_address}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                                  {(ml.generated_at || ml.created_date) && (
                                    <span>{format(new Date(ml.generated_at || ml.created_date), 'MMM d, yyyy')}</span>
                                  )}
                                  {ml.totals?.grand_total > 0 && (
                                    <span className="text-green-700 font-medium">
                                      Grand Total: ${Number(ml.totals.grand_total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  )}
                                  {ml.materials?.length > 0 && (
                                    <span>{ml.materials.length} item{ml.materials.length !== 1 ? 's' : ''}</span>
                                  )}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setViewingMaterialList(ml); setMlViewTab('order'); }}
                                data-testid={`button-view-material-list-${ml.id}`}
                              >
                                <Eye className="w-4 h-4 mr-1.5" />
                                View
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {HIDDEN_FEATURES.COLOR_VISUALIZER !== false && (
              <TabsContent value="color-visualizer" className="mt-0">
                {activeSection === "color-visualizer" && customer && (
                  <ColorVisualizerPanel
                    entity={customer}
                    entityType="Customer"
                    companyId={myCompany?.id}
                    queryKey={['customer', customerId]}
                  />
                )}
              </TabsContent>
            )}

          </div>
        </div>
      </Tabs>

      {viewingFile && (
        <Dialog open={!!viewingFile} onOpenChange={(open) => { if (!open) { setViewingFile(null); setFileZoom(1); } }}>
          <DialogContent className="max-w-[95vw] w-[95vw] sm:max-w-[95vw] sm:w-[95vw] h-[95vh] max-h-[95vh] overflow-hidden flex flex-col p-4 md:p-6">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-4 pr-8">
                <span className="truncate text-base md:text-lg">{viewingFile.document_name}</span>
                <div className="flex gap-2 items-center flex-wrap">
                  {viewingFile.file_type?.startsWith('image/') && !isHeicFile(viewingFile.document_name) && (
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
                  {viewingFile.file_type === 'application/pdf' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(viewingFile.file_url, '_blank')}
                    >
                      <Maximize2 className="w-4 h-4 mr-2" />
                      Full Screen
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownload(viewingFile)}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                </div>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4 flex-1 overflow-auto min-h-0">
              {isHeicFile(viewingFile.document_name) ? (
                <div className="text-center py-12 bg-yellow-50 rounded-lg border-2 border-yellow-200">
                  <Image className="w-16 h-16 mx-auto mb-4 text-yellow-600" />
                  <p className="text-yellow-800 font-semibold mb-2">⚠️ HEIC Format Not Supported</p>
                  <p className="text-sm text-yellow-700 mb-4">
                    HEIC is Apple's format and can't be displayed in web browsers.
                  </p>
                  <p className="text-sm text-yellow-700 mb-4">
                    Please convert to JPG or PNG to view in browser.
                  </p>
                  <Button onClick={() => handleDownload(viewingFile)} className="bg-yellow-600 hover:bg-yellow-700">
                    <Download className="w-4 h-4 mr-2" />
                    Download HEIC File
                  </Button>
                </div>
              ) : viewingFile.file_type?.startsWith('image/') ? (
                <>
                  <div className="w-full h-full overflow-auto flex items-start justify-center bg-gray-50 rounded-lg">
                    <img 
                      src={viewingFile.file_url} 
                      alt={viewingFile.document_name}
                      className="h-auto rounded-lg origin-top transition-transform"
                      style={{ width: `${fileZoom * 100}%`, maxWidth: fileZoom <= 1 ? '100%' : 'none' }}
                      onError={(e) => {
                        console.error('Modal image failed to load:', {
                          fileUrl: typeof viewingFile.file_url === 'string' ? viewingFile.file_url : JSON.stringify(viewingFile.file_url)
                        });
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'block';
                      }}
                    />
                    <div style={{display: 'none'}} className="text-center py-12 bg-gray-100 rounded-lg w-full">
                      <p className="text-red-600 mb-2">⚠️ Image failed to load</p>
                      <p className="text-xs text-gray-500 mb-4 break-all px-4">URL: {viewingFile.file_url}</p>
                      <Button onClick={() => handleDownload(viewingFile)}>
                        <Download className="w-4 h-4 mr-2" />
                        Download Instead
                      </Button>
                    </div>
                  </div>
                </>
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
                  <Button onClick={() => handleDownload(viewingFile)}>
                    <Download className="w-4 h-4 mr-2" />
                    Download File
                  </Button>
                </div>
              )}
              {viewingFile.description && (
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-gray-700 mb-1">Notes:</p>
                  <p className="text-sm text-gray-600">{viewingFile.description}</p>
                </div>
              )}
              <div className="text-xs text-gray-500">
                Uploaded: {viewingFile.created_date ? format(new Date(viewingFile.created_date), 'PPP') : 'Unknown'}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={showPaymentDialog} onOpenChange={handlePaymentDialogChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRecordPayment} className="space-y-4">
            <div>
              <Label>Amount *</Label>
              <Input
                type="text"
                value={paymentForm.amount}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^0-9.]/g, '');
                  setPaymentForm({...paymentForm, amount: value});
                }}
                placeholder="0.00"
                required
              />
            </div>

            <div>
              <Label>Payment Date *</Label>
              <Input
                type="date"
                value={paymentForm.payment_date}
                onChange={(e) => setPaymentForm({...paymentForm, payment_date: e.target.value})}
                required
              />
            </div>

            <div>
              <Label>Payment Method *</Label>
              <div className="flex items-center gap-1">
                <Select
                  value={paymentForm.payment_method}
                  onValueChange={(value) => setPaymentForm({...paymentForm, payment_method: value})}
                >
                  <SelectTrigger className="flex-1" data-testid="select-payment-method">
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                   <SelectItem value="cash">Cash</SelectItem>
                   <SelectItem value="check">Check</SelectItem>
                   <SelectItem value="credit_card">Credit Card</SelectItem>
                   <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                   <SelectItem value="paypal">PayPal</SelectItem>
                   <SelectItem value="stripe">Stripe</SelectItem>
                   <SelectItem value="cash_app">Cash App</SelectItem>
                   <SelectItem value="zelle">Zelle</SelectItem>
                   <SelectItem value="venmo">Venmo</SelectItem>
                   {customPaymentMethods.map(m => (
                     <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                   ))}
                   <SelectSeparator />
                   <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => { setShowAddPaymentMethod(true); setNewPaymentMethodName(""); }}
                  data-testid="button-add-payment-method"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {showAddPaymentMethod && (
                <div className="flex items-center gap-1 mt-2">
                  <Input
                    placeholder="e.g., Apple Pay, Crypto..."
                    className="flex-1 h-8 text-sm"
                    value={newPaymentMethodName}
                    onChange={(e) => setNewPaymentMethodName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (!newPaymentMethodName.trim()) return;
                        const val = newPaymentMethodName.trim().toLowerCase().replace(/\s+/g, '_');
                        const label = newPaymentMethodName.trim();
                        const updated = [...customPaymentMethods, { value: val, label }];
                        setCustomPaymentMethods(updated);
                        localStorage.setItem('custom_payment_methods', JSON.stringify(updated));
                        setPaymentForm({...paymentForm, payment_method: val});
                        setShowAddPaymentMethod(false);
                        setNewPaymentMethodName("");
                      }
                    }}
                    autoFocus
                    data-testid="input-new-payment-method"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      if (!newPaymentMethodName.trim()) return;
                      const val = newPaymentMethodName.trim().toLowerCase().replace(/\s+/g, '_');
                      const label = newPaymentMethodName.trim();
                      const updated = [...customPaymentMethods, { value: val, label }];
                      setCustomPaymentMethods(updated);
                      localStorage.setItem('custom_payment_methods', JSON.stringify(updated));
                      setPaymentForm({...paymentForm, payment_method: val});
                      setShowAddPaymentMethod(false);
                      setNewPaymentMethodName("");
                    }}
                    data-testid="button-confirm-add-method"
                  >
                    Add
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => setShowAddPaymentMethod(false)}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Paid By</Label>
                <Input
                  value={paymentForm.payer_name}
                  onChange={(e) => setPaymentForm({...paymentForm, payer_name: e.target.value})}
                  placeholder={customer?.name || "Payer name"}
                  data-testid="input-payment-payer-name"
                />
              </div>
              <div>
                <Label>Payer Email</Label>
                <Input
                  type="email"
                  value={paymentForm.payer_email}
                  onChange={(e) => setPaymentForm({...paymentForm, payer_email: e.target.value})}
                  placeholder={customer?.email || "payer@example.com"}
                  data-testid="input-payment-payer-email"
                />
              </div>
              <p className="text-xs text-gray-500 sm:col-span-2">
                This identifies who supplied the money. The payment will still be applied to {customer?.name}.
              </p>
            </div>

            <div>
              <Label>Invoice Number (Optional)</Label>
              <Select
                value={paymentForm.invoice_number || "none"}
                onValueChange={(val) => {
                  const selectedInvoiceNumber = val === "none" ? "" : val;
                  setPaymentForm({...paymentForm, invoice_number: selectedInvoiceNumber});
                  const invoice = invoices.find(inv => inv.invoice_number === selectedInvoiceNumber);
                  if (invoice) {
                    const remaining = invoice.amount - (invoice.amount_paid || 0);
                    setPaymentForm(prev => ({...prev, amount: remaining.toFixed(2)}));
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select invoice (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {invoices
                    .filter(inv =>
                        ['sent', 'draft', 'viewed', 'overdue', 'partially_paid'].includes(inv.status) &&
                        (inv.amount || 0) > (inv.amount_paid || 0)
                    )
                    .map(inv => (
                      <SelectItem key={inv.id} value={inv.invoice_number}>
                        {inv.invoice_number} - ${(inv.amount - (inv.amount_paid || 0)).toFixed(2)} due
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {paymentForm.invoice_number && (
                <p className="text-xs text-green-600 mt-1">✓ Linked to {paymentForm.invoice_number}</p>
              )}
            </div>

            <div>
              <Label>Reference Number</Label>
              <Input
                value={paymentForm.reference_number}
                onChange={(e) => setPaymentForm({...paymentForm, reference_number: e.target.value})}
                placeholder="Check #, Transaction ID, etc."
              />
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({...paymentForm, notes: e.target.value})}
                placeholder="Additional notes..."
                rows={3}
              />
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="send_receipt"
                checked={paymentForm.send_receipt}
                onChange={(e) => setPaymentForm({...paymentForm, send_receipt: e.target.checked})}
                className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              <Label htmlFor="send_receipt" className="font-normal cursor-pointer">Send receipt to customer</Label>
            </div>

            <div className="flex justify-end gap-3">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setShowPaymentDialog(false)}
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={createPaymentMutation.isPending}
                className="bg-green-600 hover:bg-green-700"
              >
                {createPaymentMutation.isPending ? 'Recording...' : 'Record Payment'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditPaymentDialog} onOpenChange={setShowEditPaymentDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Payment</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e)=>{e.preventDefault(); updatePaymentMutation.mutate();}} className="space-y-4">
            <div>
              <Label>Amount *</Label>
              <Input type="text" value={editPaymentForm.amount} onChange={(e)=>setEditPaymentForm({...editPaymentForm, amount: e.target.value.replace(/[^0-9.]/g,'')})} required />
            </div>
            <div>
              <Label>Payment Date *</Label>
              <Input type="date" value={editPaymentForm.payment_date} onChange={(e)=>setEditPaymentForm({...editPaymentForm, payment_date: e.target.value})} required />
            </div>
            <div>
              <Label>Payment Method *</Label>
              <div className="flex items-center gap-1">
                <Select value={editPaymentForm.payment_method} onValueChange={(v)=>setEditPaymentForm({...editPaymentForm, payment_method: v})}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Select method"/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="credit_card">Credit Card</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="paypal">PayPal</SelectItem>
                    <SelectItem value="stripe">Stripe</SelectItem>
                    <SelectItem value="cash_app">Cash App</SelectItem>
                    <SelectItem value="zelle">Zelle</SelectItem>
                    <SelectItem value="venmo">Venmo</SelectItem>
                    {customPaymentMethods.map(m => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                    <SelectSeparator />
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => { setShowAddPaymentMethod(true); setNewPaymentMethodName(""); }}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div>
              <Label>Paid By</Label>
              <Input value={editPaymentForm.payer_name || ''} onChange={(e)=>setEditPaymentForm({...editPaymentForm, payer_name: e.target.value})} />
            </div>
            <div>
              <Label>Payer Email</Label>
              <Input type="email" value={editPaymentForm.payer_email || ''} onChange={(e)=>setEditPaymentForm({...editPaymentForm, payer_email: e.target.value})} />
            </div>
            <div>
              <Label>Invoice Number</Label>
              <Input value={editPaymentForm.invoice_number || ''} onChange={(e)=>setEditPaymentForm({...editPaymentForm, invoice_number: e.target.value})} placeholder="e.g., INV-2032" />
            </div>
            <div>
              <Label>Reference Number</Label>
              <Input value={editPaymentForm.reference_number || ''} onChange={(e)=>setEditPaymentForm({...editPaymentForm, reference_number: e.target.value})} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={3} value={editPaymentForm.notes || ''} onChange={(e)=>setEditPaymentForm({...editPaymentForm, notes: e.target.value})} />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={()=>setShowEditPaymentDialog(false)}>Cancel</Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700">Save Changes</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialer 
        open={showDialer} 
        onOpenChange={setShowDialer}
        defaultNumber={customer.phone || customer.phone_2}
        defaultName={customer.name}
      />
      <EmailDialog 
        open={showEmailDialog} 
        onOpenChange={setShowEmailDialog}
        defaultTo={customer.email}
        defaultName={customer.name}
        companyId={myCompany?.id}
      />
      <SMSDialog 
        open={showSMSDialog} 
        onOpenChange={setShowSMSDialog}
        defaultTo={customer.phone || customer.phone_2}
        defaultName={customer.name}
        defaultFrom={replyFromNumber}
        companyId={myCompany?.id}
        isRepOwned={isCustomerRepOwned}
        onHandBack={handleHandBackToSarahCustomer}
      />

      <Dialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {selectedFiles.length} File(s)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert className="bg-red-50 border-red-200">
              <AlertDescription className="text-red-900 text-sm">
                ⚠️ You are about to delete {selectedFiles.length} file(s). This action cannot be undone.
              </AlertDescription>
            </Alert>
            
            <div>
              <Label>Notes / Reason for deletion (optional)</Label>
              <Textarea
                value={bulkDeleteNotes}
                onChange={(e) => setBulkDeleteNotes(e.target.value)}
                placeholder="e.g., Duplicate files, poor quality, incorrect photos..."
                rows={4}
              />
              <p className="text-xs text-gray-500 mt-1">
                These notes will be added to each file before deletion for audit trail.
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => {
                  setShowBulkDeleteDialog(false);
                  setBulkDeleteNotes('');
                }}
              >
                Cancel
              </Button>
              <BulkDeleteButton
                onClick={async () => {
                  try {
                    await base44.entities.Document.bulkDelete(selectedFiles, { validateOnly: true });
                    // If notes provided, update each file first
                    if (bulkDeleteNotes.trim()) {
                      for (const fileId of selectedFiles) {
                        const file = files.find(f => f.id === fileId);
                        if (file) {
                          const timestamp = new Date().toLocaleString();
                          const deletionNote = `[DELETED ${timestamp}] ${bulkDeleteNotes}`;
                          const updatedDescription = file.description 
                            ? `${file.description}\n\n${deletionNote}`
                            : deletionNote;
                          
                          await base44.entities.Document.update(fileId, {
                            description: updatedDescription
                          });
                        }
                      }
                    }

                    // Then delete all selected files
                    await base44.entities.Document.bulkDelete(selectedFiles);
                    queryClient.invalidateQueries({ queryKey: ['customer-files'] });

                    setSelectedFiles([]);
                    setShowBulkDeleteDialog(false);
                    setBulkDeleteNotes('');
                    toast.success(`✅ Deleted ${selectedFiles.length} file(s)`);
                  } catch (error) {
                    toast.error('Failed to delete files: ' + error.message);
                  }
                }}
                className="bg-red-600 hover:bg-red-700"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Confirm Delete
              </BulkDeleteButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showCheckUploadDialog}
        onOpenChange={(open) => {
          setShowCheckUploadDialog(open);
          if (!open && !isProcessingCheck) setCheckInvoiceId('');
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-blue-600" />
              Scan Check Payment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription className="text-blue-900 text-sm">
                📸 Take a clear photo of the check. AI will automatically extract the amount, check number, date, and payer information, then create both a payment record and save the image to this customer's files.
              </AlertDescription>
            </Alert>

            {outstandingInvoicesForCheck.length > 0 && (
              <div>
                <Label>Apply Check To Invoice</Label>
                <Select value={checkInvoiceId} onValueChange={setCheckInvoiceId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Choose the invoice this check pays" />
                  </SelectTrigger>
                  <SelectContent>
                    {outstandingInvoicesForCheck.map((inv) => {
                      const total = Number(inv.total_amount ?? inv.amount ?? 0);
                      const remaining = Math.max(0, total - Number(inv.amount_paid || 0));
                      return (
                        <SelectItem key={inv.id} value={inv.id}>
                          {inv.invoice_number} — ${remaining.toFixed(2)} due
                        </SelectItem>
                      );
                    })}
                    <SelectItem value="__unlinked__">Record without applying to an invoice</SelectItem>
                  </SelectContent>
                </Select>
                {checkInvoiceId && checkInvoiceId !== '__unlinked__' && (
                  <p className="text-xs text-green-600 mt-1">
                    The invoice balance will update automatically.
                  </p>
                )}
              </div>
            )}
            
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleCheckUpload}
                disabled={isProcessingCheck}
                className="hidden"
                id="check-upload-input"
              />
              <label htmlFor="check-upload-input" className="cursor-pointer">
                {isProcessingCheck ? (
                  <div className="space-y-3">
                    <Loader2 className="w-12 h-12 mx-auto text-blue-600 animate-spin" />
                    <p className="text-sm text-gray-600">Processing check with AI...</p>
                    <p className="text-xs text-gray-500">This may take 10-15 seconds</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Camera className="w-12 h-12 mx-auto text-gray-400" />
                    <div>
                      <p className="text-sm font-medium text-gray-700">Click to take photo or upload</p>
                      <p className="text-xs text-gray-500 mt-1">Supports JPG, PNG, HEIC</p>
                    </div>
                  </div>
                )}
              </label>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-600 space-y-2">
              <p className="font-semibold text-gray-700">📋 What happens next:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>AI extracts payment details from check</li>
                <li>Payment record created automatically</li>
                <li>Check image saved to customer files</li>
                <li>Linked to invoice (if applicable)</li>
              </ul>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-600 space-y-2">
              <p className="font-semibold text-gray-700">Tips for best results:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Ensure good lighting</li>
                <li>Capture the entire check</li>
                <li>Avoid glare and shadows</li>
                <li>Keep the check flat and straight</li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showTaskDialog} onOpenChange={setShowTaskDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Task for {customer.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (!taskForm.name) {
              toast.error('Please enter a task title');
              return;
            }
            createTaskMutation.mutate(taskForm);
          }} className="space-y-4">
            <div>
              <Label>Task Title *</Label>
              <Input
                value={taskForm.name}
                onChange={(e) => setTaskForm({...taskForm, name: e.target.value})}
                placeholder="e.g., Follow up on estimate"
                required
              />
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={taskForm.description}
                onChange={(e) => setTaskForm({...taskForm, description: e.target.value})}
                placeholder="Add task details..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Priority</Label>
                <Select value={taskForm.priority} onValueChange={(v) => setTaskForm({...taskForm, priority: v})}>
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

              <div>
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={taskForm.due_date}
                  onChange={(e) => setTaskForm({...taskForm, due_date: e.target.value})}
                />
              </div>
            </div>

            <div>
              <Label>Assign To</Label>
              <Select value={taskForm.assigned_to} onValueChange={(v) => setTaskForm({...taskForm, assigned_to: v})}>
                <SelectTrigger>
                  <SelectValue placeholder="Select staff member" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {allCompanyStaff.filter(s => s.user_email).map(staff => (
                    <SelectItem key={staff.user_email} value={staff.user_email}>
                      {staff.full_name || staff.user_email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded p-3">
              <p className="text-sm text-blue-900">
                <strong>📌 Auto-linked to:</strong> {customer.name}
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setShowTaskDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={createTaskMutation.isPending}>
                {createTaskMutation.isPending ? 'Creating...' : 'Create Task'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AssignmentDialog
        isOpen={isNewInspectionOpen}
        onOpenChange={setIsNewInspectionOpen}
        prefillCustomer={customer}
        onAssignmentSent={() => {
          setIsNewInspectionOpen(false);
          setActiveSection('crewcam');
        }}
      />

      {/* Commission Split Suggestion Dialog */}
      <Dialog open={showCommissionSplitPrompt} onOpenChange={setShowCommissionSplitPrompt}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-green-600" />
              Set Up Commission Split?
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-gray-600">
              You have <strong>{suggestedSplitStaff.length} sales reps</strong> assigned to this customer, all with commission rates:
            </p>
            <div className="bg-gray-50 rounded-lg p-3 space-y-1">
              {suggestedSplitStaff.map(s => (
                <div key={s.user_email} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{s.full_name || s.user_email}</span>
                  <span className="text-green-600 text-xs">{s.commission_rate}% commission rate</span>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-600">
              Would you like to split commissions equally between them ({Math.round(100 / suggestedSplitStaff.length)}% each)?
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              onClick={() => {
                if (!pendingSaveArgs) return;
                const { dataToSave, originalAssignedUsers, originalCommissionSplits } = pendingSaveArgs;
                const equalSplit = 100 / suggestedSplitStaff.length;
                const splits = suggestedSplitStaff.map(s => ({
                  user_email: s.user_email,
                  user_name: s.full_name || s.user_email,
                  split_percentage: parseFloat(equalSplit.toFixed(2)),
                  role: 'Sales Rep'
                }));
                const updatedData = { ...dataToSave, commission_splits: splits };
                setCustomerData(prev => ({ ...prev, commission_splits: splits }));
                setShowCommissionSplitPrompt(false);
                setPendingSaveArgs(null);
                doSaveCustomer(updatedData, originalAssignedUsers, originalCommissionSplits);
              }}
              data-testid="button-split-equally"
            >
              Split equally ({Math.round(100 / Math.max(suggestedSplitStaff.length, 1))}% each)
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                // Let user customize — pre-populate splits and scroll to section
                if (!pendingSaveArgs) return;
                const equalSplit = 100 / suggestedSplitStaff.length;
                const splits = suggestedSplitStaff.map(s => ({
                  user_email: s.user_email,
                  user_name: s.full_name || s.user_email,
                  split_percentage: parseFloat(equalSplit.toFixed(2)),
                  role: 'Sales Rep'
                }));
                setCustomerData(prev => ({ ...prev, commission_splits: splits }));
                setShowCommissionSplitPrompt(false);
                setPendingSaveArgs(null);
                // Scroll to commission splits section
                setTimeout(() => {
                  document.querySelector('[data-testid="select-add-commission-split"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
              }}
              data-testid="button-customize-splits"
            >
              Let me customize the splits first
            </Button>
            <Button
              variant="ghost"
              className="w-full text-gray-500"
              onClick={() => {
                if (!pendingSaveArgs) return;
                const { dataToSave, originalAssignedUsers, originalCommissionSplits } = pendingSaveArgs;
                setShowCommissionSplitPrompt(false);
                setPendingSaveArgs(null);
                doSaveCustomer(dataToSave, originalAssignedUsers, originalCommissionSplits);
              }}
              data-testid="button-skip-splits"
            >
              No, save without commission splits
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Material List View Dialog */}
      {viewingMaterialList && (
        <Dialog open={!!viewingMaterialList} onOpenChange={(open) => { if (!open) setViewingMaterialList(null); }}>
          <DialogContent className="!max-w-[92vw] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-green-600" />
                  Material Purchase List
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {viewingMaterialList.estimate_number && <span className="font-medium text-gray-700 mr-2">{viewingMaterialList.estimate_number}</span>}
                  {viewingMaterialList.property_address}
                  {(viewingMaterialList.generated_at || viewingMaterialList.created_date) && (
                    <span className="ml-2">· {format(new Date(viewingMaterialList.generated_at || viewingMaterialList.created_date), 'MMM d, yyyy')}</span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={refreshingMaterialList || !viewingMaterialList.estimate_id}
                  title="Replaces this saved material list with the current estimate scope. Does not change estimate prices."
                  onClick={refreshViewedMaterialList} data-testid="refresh-material-list">
                  {refreshingMaterialList ? 'Refreshing…' : 'Refresh from estimate'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setViewingMaterialList(null)}>Close</Button>
              </div>
            </div>
            <MissingPurchaseMaterials items={viewingMaterialList.missing_materials || []} pricingIncomplete={viewingMaterialList.pricing_incomplete} />
            <div className="flex border-b shrink-0 px-2 bg-white">
              {[{ key: 'order', label: '📋 Order Sheet' }, { key: 'summary', label: '💰 Cost Summary' }].map(tab => (
                <button key={tab.key} onClick={() => setMlViewTab(tab.key)}
                  className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${mlViewTab === tab.key ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-auto">
              {mlViewTab === 'order' && (
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-10 bg-white border-b shadow-sm">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">Description</th>
                      <th className="px-3 py-3 text-right font-semibold text-gray-700 w-24">Estimate Qty</th>
                      <th className="px-3 py-3 text-left font-semibold text-gray-700 w-24">Unit</th>
                      <th className="px-3 py-3 text-right font-semibold text-green-800 bg-green-50 w-24">Order Qty</th>
                      <th className="px-3 py-3 text-left font-semibold text-green-800 bg-green-50 w-24">Order Unit</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-500 text-xs w-48">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(viewingMaterialList.materials || []).length > 0 && (
                      <>
                        <tr className="bg-green-50">
                          <td colSpan={6} className="px-4 py-2 font-semibold text-green-800 text-xs uppercase tracking-wide">Materials</td>
                        </tr>
                        {(viewingMaterialList.materials || []).map((item, i) => (
                          <MaterialPurchaseRow key={`m-${i}`} item={item} />
                        ))}
                      </>
                    )}
                    {(viewingMaterialList.labor || []).length > 0 && (
                      <>
                        <tr className="bg-blue-50">
                          <td colSpan={6} className="px-4 py-2 font-semibold text-blue-800 text-xs uppercase tracking-wide">Labor</td>
                        </tr>
                        {(viewingMaterialList.labor || []).map((item, i) => (
                          <tr key={`l-${i}`} className="border-b hover:bg-gray-50">
                            <td className="px-4 py-2.5 text-gray-900">{item.name || item.description}</td>
                            <td className="px-3 py-2.5 text-right text-gray-700 tabular-nums">{item.quantity}</td>
                            <td className="px-3 py-2.5 text-gray-600">{item.unit}</td>
                            <td className="px-3 py-2.5 text-gray-400">—</td>
                            <td className="px-3 py-2.5 text-gray-400">—</td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs">{item.notes}</td>
                          </tr>
                        ))}
                      </>
                    )}
                    {(viewingMaterialList.other || []).length > 0 && (
                      <>
                        <tr className="bg-gray-50">
                          <td colSpan={6} className="px-4 py-2 font-semibold text-gray-600 text-xs uppercase tracking-wide">Other</td>
                        </tr>
                        {(viewingMaterialList.other || []).map((item, i) => (
                          <tr key={`o-${i}`} className="border-b hover:bg-gray-50">
                            <td className="px-4 py-2.5 text-gray-900">{item.name || item.description}</td>
                            <td className="px-3 py-2.5 text-right text-gray-700 tabular-nums">{item.quantity}</td>
                            <td className="px-3 py-2.5 text-gray-600">{item.unit}</td>
                            <td className="px-3 py-2.5 text-gray-400">—</td>
                            <td className="px-3 py-2.5 text-gray-400">—</td>
                            <td className="px-4 py-2.5 text-gray-400 text-xs">{item.notes}</td>
                          </tr>
                        ))}
                      </>
                    )}
                  </tbody>
                </table>
              )}
              {mlViewTab === 'summary' && (
                <div className="p-3 sm:p-6 space-y-4">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">Description</th>
                        <th className="px-3 py-3 text-right font-semibold text-gray-700 w-24">Qty</th>
                        <th className="px-3 py-3 text-left font-semibold text-gray-700 w-24">Unit</th>
                        <th className="px-3 py-3 text-right font-semibold text-gray-700 w-28">Unit Cost</th>
                        <th className="px-3 py-3 text-right font-semibold text-gray-700 w-28">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(viewingMaterialList.materials || []).length > 0 && (
                        <>
                          <tr className="bg-green-50"><td colSpan={5} className="px-4 py-2 font-semibold text-green-800 text-xs uppercase tracking-wide">Materials</td></tr>
                          {(viewingMaterialList.materials || []).map((item, i) => (
                            <tr key={`ms-${i}`} className="border-b hover:bg-gray-50">
                              <td className="px-4 py-2.5 text-gray-900">{item.name || item.description}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{item.quantity}</td>
                              <td className="px-3 py-2.5 text-gray-600">{item.unit}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{item.unitCost != null ? `$${Number(item.unitCost).toFixed(2)}` : '—'}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums font-medium">{item.totalCost != null ? `$${Number(item.totalCost).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</td>
                            </tr>
                          ))}
                        </>
                      )}
                      {(viewingMaterialList.labor || []).length > 0 && (
                        <>
                          <tr className="bg-blue-50"><td colSpan={5} className="px-4 py-2 font-semibold text-blue-800 text-xs uppercase tracking-wide">Labor</td></tr>
                          {(viewingMaterialList.labor || []).map((item, i) => (
                            <tr key={`ls-${i}`} className="border-b hover:bg-gray-50">
                              <td className="px-4 py-2.5 text-gray-900">{item.name || item.description}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{item.quantity}</td>
                              <td className="px-3 py-2.5 text-gray-600">{item.unit}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{item.unitCost != null ? `$${Number(item.unitCost).toFixed(2)}` : '—'}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums font-medium">{item.totalCost != null ? `$${Number(item.totalCost).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</td>
                            </tr>
                          ))}
                        </>
                      )}
                      {(viewingMaterialList.other || []).length > 0 && (
                        <>
                          <tr className="bg-gray-50"><td colSpan={5} className="px-4 py-2 font-semibold text-gray-600 text-xs uppercase tracking-wide">Other</td></tr>
                          {(viewingMaterialList.other || []).map((item, i) => (
                            <tr key={`os-${i}`} className="border-b hover:bg-gray-50">
                              <td className="px-4 py-2.5 text-gray-900">{item.name || item.description}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{item.quantity}</td>
                              <td className="px-3 py-2.5 text-gray-600">{item.unit}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{item.unitCost != null ? `$${Number(item.unitCost).toFixed(2)}` : '—'}</td>
                              <td className="px-3 py-2.5 text-right tabular-nums font-medium">{item.totalCost != null ? `$${Number(item.totalCost).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}</td>
                            </tr>
                          ))}
                        </>
                      )}
                    </tbody>
                  </table>
                  {viewingMaterialList.totals && (
                    <div className="border-t pt-4 space-y-1.5">
                      {viewingMaterialList.totals.materials > 0 && (
                        <div className="flex justify-between text-sm"><span className="text-gray-600">Materials Subtotal</span><span className="font-medium">${Number(viewingMaterialList.totals.materials).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
                      )}
                      {viewingMaterialList.totals.labor > 0 && (
                        <div className="flex justify-between text-sm"><span className="text-gray-600">Labor Subtotal</span><span className="font-medium">${Number(viewingMaterialList.totals.labor).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
                      )}
                      {viewingMaterialList.totals.other > 0 && (
                        <div className="flex justify-between text-sm"><span className="text-gray-600">Other</span><span className="font-medium">${Number(viewingMaterialList.totals.other).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
                      )}
                      <div className="flex justify-between text-base font-bold border-t pt-2 mt-2">
                        <span>Grand Total</span>
                        <span className="text-green-700">${Number(viewingMaterialList.totals.grand_total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Fullscreen crew photo viewer */}
      {viewingCrewPhoto && (
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setViewingCrewPhoto(null)}
          data-testid="crew-photo-viewer-overlay"
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
            onClick={() => setViewingCrewPhoto(null)}
            data-testid="button-close-crew-photo-viewer"
          >
            <X className="w-5 h-5" />
          </button>
          {/* Top-left action buttons: download, highlight, delete */}
          <div className="absolute top-4 left-4 flex gap-2" onClick={e => e.stopPropagation()}>
            <button
              className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
              onClick={async (e) => {
                e.stopPropagation();
                const url = viewingCrewPhoto.url;
                const filename = viewingCrewPhoto.caption
                  ? `${viewingCrewPhoto.caption.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.jpg`
                  : `crew-photo-${Date.now()}.jpg`;
                try {
                  const res = await fetch(url);
                  const blob = await res.blob();
                  const blobUrl = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = blobUrl;
                  a.download = filename;
                  a.click();
                  URL.revokeObjectURL(blobUrl);
                } catch {
                  window.open(url, '_blank');
                }
              }}
              data-testid="button-download-crew-photo"
              title="Download photo"
            >
              <Download className="w-5 h-5" />
            </button>
            {viewingCrewPhoto.id && (
              <>
                <button
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${viewingCrewPhoto.is_highlighted ? 'bg-yellow-400 text-white' : 'bg-black/50 text-white hover:bg-yellow-400'}`}
                  title={viewingCrewPhoto.is_highlighted ? 'Remove highlight' : 'Highlight photo'}
                  data-testid="button-highlight-crew-photo-viewer"
                  onClick={(e) => {
                    e.stopPropagation();
                    const newVal = !viewingCrewPhoto.is_highlighted;
                    highlightCrewPhotoMutation.mutate({ photoId: viewingCrewPhoto.id, highlighted: newVal });
                    setViewingCrewPhoto(prev => ({ ...prev, is_highlighted: newVal }));
                  }}
                >
                  <Star className={`w-5 h-5 ${viewingCrewPhoto.is_highlighted ? 'fill-white' : ''}`} />
                </button>
                <button
                  className="w-10 h-10 rounded-full bg-black/50 text-white hover:bg-red-500 flex items-center justify-center transition-colors"
                  title="Delete photo"
                  data-testid="button-delete-crew-photo-viewer"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm('Delete this photo? This cannot be undone.')) {
                      deleteCrewPhotoMutation.mutate(viewingCrewPhoto.id);
                      setViewingCrewPhoto(null);
                    }
                  }}
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </>
            )}
          </div>
          <div className="max-w-4xl max-h-[90vh] w-full flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <img
              src={viewingCrewPhoto.url}
              alt={viewingCrewPhoto.caption || 'Crew photo'}
              className="max-h-[80vh] max-w-full object-contain rounded-lg shadow-2xl"
            />
            <div className="text-center space-y-1.5">
              {viewingCrewPhoto.source && (
                <div className="flex items-center justify-center gap-2">
                  {viewingCrewPhoto.source === 'whatsapp_upload' ? (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/90 text-white text-xs font-medium">
                      <SiWhatsapp className="w-3.5 h-3.5" />
                      WhatsApp
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/90 text-white text-xs font-medium">
                      <Upload className="w-3 h-3" />
                      Crew Upload
                    </span>
                  )}
                  {viewingCrewPhoto.uploaded_by_name && (
                    <span className="text-gray-300 text-xs">{viewingCrewPhoto.uploaded_by_name}</span>
                  )}
                </div>
              )}
              {viewingCrewPhoto.caption && <p className="text-white text-sm font-medium">{viewingCrewPhoto.caption}</p>}
              {viewingCrewPhoto.date && <p className="text-gray-400 text-xs">{new Date(viewingCrewPhoto.date).toLocaleDateString()}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Send Portal Link Dialog */}
      <Dialog open={showPortalDialog} onOpenChange={(open) => { setShowPortalDialog(open); setSendingPortalLink(null); setConfirmPortalSend(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-purple-600" />
              Send Customer Portal Link
            </DialogTitle>
          </DialogHeader>

          {/* ── CONFIRMATION STEP ── */}
          {confirmPortalSend ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-gray-700">
                Send the portal link to <strong>{confirmPortalSend.contact}</strong> via {confirmPortalSend.label}?
              </p>
              <p className="text-xs text-gray-400">
                {confirmPortalSend.method === 'sms'
                  ? `${customer?.name} will receive a text with a private link to their project portal.`
                  : `${customer?.name} will receive an email with a private link to their project portal.`}
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setConfirmPortalSend(null)}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  disabled={!!sendingPortalLink}
                  onClick={async () => {
                    setSendingPortalLink(confirmPortalSend.method);
                    try {
                      const sentKey = confirmPortalSend.method === 'sms' ? 'sms_sent' : 'email_sent';
                      const r = await fetch('/api/portal/send-portal-link', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ customer_id: customer.id, method: confirmPortalSend.method }),
                      });
                      const d = await r.json();
                      if (d.success && d[sentKey]) {
                        toast.success(`Portal link sent to ${confirmPortalSend.contact}`);
                        setShowPortalDialog(false);
                        setConfirmPortalSend(null);
                      } else {
                        toast.error(`${confirmPortalSend.label === 'text' ? 'Text' : 'Email'} failed — check your settings`);
                      }
                    } catch {
                      toast.error('Failed to send');
                    } finally {
                      setSendingPortalLink(null);
                    }
                  }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  {sendingPortalLink ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Send
                </button>
              </div>
            </div>

          ) : (
          /* ── CHOICE STEP ── */
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600">
              How would you like to send <strong>{customer?.name}</strong> their portal link?
            </p>
            <div className="space-y-2">
              {customer?.phone && (
                <button
                  onClick={() => setConfirmPortalSend({ method: 'sms', label: 'text', contact: customer.phone })}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-green-200 bg-green-50 hover:bg-green-100 text-left transition-colors"
                >
                  <MessageSquare className="w-5 h-5 text-green-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-green-800">Send via Text</p>
                    <p className="text-xs text-green-600">{customer.phone}</p>
                  </div>
                </button>
              )}
              {customer?.email && (
                <button
                  onClick={() => setConfirmPortalSend({ method: 'email', label: 'email', contact: customer.email })}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-purple-200 bg-purple-50 hover:bg-purple-100 text-left transition-colors"
                >
                  <Mail className="w-5 h-5 text-purple-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-purple-800">Send via Email</p>
                    <p className="text-xs text-purple-600">{customer.email}</p>
                  </div>
                </button>
              )}
              <button
                onClick={async () => {
                  try {
                    let tok = customer?.portal_token;
                    if (!tok) {
                      const r = await fetch('/api/portal/send-portal-link', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ customer_id: customer.id, method: 'none' }),
                      });
                      const d = await r.json();
                      if (!r.ok || !d.success) throw new Error(d.error || 'Could not create a portal link.');
                      tok = d.portal_url ? new URL(d.portal_url).searchParams.get('token') : null;
                      queryClient.invalidateQueries({ queryKey: ['customer', customer.id] });
                    }
                    if (!tok) throw new Error('No portal token was returned. Please try again.');
                    const url = `${window.location.origin}/portal?token=${encodeURIComponent(tok)}`;
                    await navigator.clipboard.writeText(url);
                    toast.success('Portal link copied to clipboard');
                  } catch {
                    toast.error('Failed to copy link');
                  }
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 text-left transition-colors"
              >
                <Copy className="w-5 h-5 text-gray-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-gray-700">Copy Link</p>
                  <p className="text-xs text-gray-500">Paste into any message</p>
                </div>
              </button>
            </div>
            {!customer?.phone && !customer?.email && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-2">No phone or email on file — add contact info first, then come back here.</p>
            )}
          </div>
          )}
        </DialogContent>
      </Dialog>

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
                if (signatureContractForm.delivery_method === 'email' && !customer.email) { toast.error('This customer has no email on file'); return; }
                if (signatureContractForm.delivery_method === 'sms' && !customer.phone) { toast.error('This customer has no phone on file'); return; }
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
                      setSignatureContractForm(prev => ({ ...prev, contract_name: `${customer.name} - ${t.template_name}` }));
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
                <p className="font-medium text-gray-700 mb-2">Customer (pre-filled)</p>
                <p><span className="text-gray-500">Name:</span> {customer.name}</p>
                {customer.email && <p><span className="text-gray-500">Email:</span> {customer.email}</p>}
                {customer.phone && <p><span className="text-gray-500">Phone:</span> {customer.phone}</p>}
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
                    {!customer.email && <span className="text-xs text-red-500">(no email on file)</span>}
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="sms"
                      checked={signatureContractForm.delivery_method === 'sms'}
                      onChange={(e) => setSignatureContractForm(prev => ({ ...prev, delivery_method: e.target.value }))}
                      className="w-4 h-4"
                    />
                    <MessageSquare className="w-4 h-4 text-green-600" />
                    SMS
                    {!customer.phone && <span className="text-xs text-red-500">(no phone on file)</span>}
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

      {/* ── Send Photos to Customer Dialog ─────────────────────────────── */}
      <Dialog open={sendPhotosOpen} onOpenChange={(o) => { if (!sendPhotosMutation.isPending) setSendPhotosOpen(o); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-orange-500" />
              Send Photos to {customer?.name}
            </DialogTitle>
            {customer?.email ? (
              <p className="text-sm text-gray-500 mt-1">Will be emailed to <span className="font-medium">{customer.email}</span></p>
            ) : (
              <div className="mt-2 flex items-start gap-2 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm text-yellow-800">
                <span className="mt-0.5 shrink-0">⚠️</span>
                <span>No email on file for this customer. Add an email address to their profile before sending.</span>
              </div>
            )}
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-600 font-medium">
                {selectedPhotoIds.size > 0 ? `${selectedPhotoIds.size} photo${selectedPhotoIds.size > 1 ? 's' : ''} selected` : 'Select photos to send'}
              </span>
              <button
                onClick={() => {
                  if (selectedPhotoIds.size === crewPhotos.length) {
                    setSelectedPhotoIds(new Set());
                  } else {
                    setSelectedPhotoIds(new Set(crewPhotos.map(p => p.id)));
                  }
                }}
                className="text-sm text-orange-600 hover:text-orange-700 hover:underline font-medium"
                data-testid="button-select-all-photos"
              >
                {selectedPhotoIds.size === crewPhotos.length ? 'Deselect all' : `Select all (${crewPhotos.length})`}
              </button>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-5">
              {crewPhotos.map(photo => {
                const url = photo.file_url || photo.url;
                const isSelected = selectedPhotoIds.has(photo.id);
                return (
                  <div
                    key={photo.id}
                    onClick={() => setSelectedPhotoIds(prev => {
                      const next = new Set(prev);
                      if (next.has(photo.id)) next.delete(photo.id); else next.add(photo.id);
                      return next;
                    })}
                    className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${isSelected ? 'border-orange-500 ring-2 ring-orange-200' : 'border-transparent hover:border-gray-300'}`}
                    data-testid={`send-photo-select-${photo.id}`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" onError={e => { e.target.style.display = 'none'; }} />
                    {isSelected && (
                      <div className="absolute inset-0 bg-orange-500/20 flex items-center justify-center">
                        <CheckCircle className="w-7 h-7 text-orange-600 drop-shadow-sm" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div>
              <Label className="text-sm font-medium">Message (optional)</Label>
              <Textarea
                className="mt-1.5"
                placeholder="Add a personal note to include with the photos…"
                value={sendPhotosMsg}
                onChange={e => setSendPhotosMsg(e.target.value)}
                rows={2}
                data-testid="input-send-photos-message"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 px-6 py-4 border-t bg-gray-50 rounded-b-lg">
            <Button variant="outline" onClick={() => setSendPhotosOpen(false)} disabled={sendPhotosMutation.isPending} data-testid="button-cancel-send-photos">
              Cancel
            </Button>
            <Button
              disabled={selectedPhotoIds.size === 0 || sendPhotosMutation.isPending || !customer?.email}
              onClick={() => sendPhotosMutation.mutate({ photoIds: selectedPhotoIds, message: sendPhotosMsg })}
              data-testid="button-confirm-send-photos"
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {sendPhotosMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending…</>
              ) : (
                <><Mail className="w-4 h-4 mr-2" />Send {selectedPhotoIds.size > 0 ? `${selectedPhotoIds.size} Photo${selectedPhotoIds.size > 1 ? 's' : ''}` : 'Photos'}</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showLogCallDialog} onOpenChange={setShowLogCallDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Log a Call</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleLogCall} className="space-y-4">
            <div>
              <Label>Direction</Label>
              <Select
                value={logCallForm.direction}
                onValueChange={(v) => setLogCallForm(f => ({ ...f, direction: v }))}
              >
                <SelectTrigger className="mt-1" data-testid="select-call-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inbound">Inbound (they called you)</SelectItem>
                  <SelectItem value="outbound">Outbound (you called them)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                className="mt-1"
                value={logCallForm.call_date}
                onChange={(e) => setLogCallForm(f => ({ ...f, call_date: e.target.value }))}
                required
                data-testid="input-call-date"
              />
            </div>
            <div>
              <Label>Duration (minutes)</Label>
              <Input
                type="number"
                className="mt-1"
                min="0"
                step="1"
                placeholder="e.g. 5"
                value={logCallForm.duration_minutes}
                onChange={(e) => setLogCallForm(f => ({ ...f, duration_minutes: e.target.value }))}
                data-testid="input-call-duration"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                className="mt-1"
                rows={3}
                placeholder="What was discussed?"
                value={logCallForm.notes}
                onChange={(e) => setLogCallForm(f => ({ ...f, notes: e.target.value }))}
                data-testid="input-call-notes"
              />
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <Button type="button" variant="outline" onClick={() => setShowLogCallDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoggingCall} data-testid="button-save-call-log">
                {isLoggingCall ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : 'Save Call'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deactivateConfirmOpen} onOpenChange={setDeactivateConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <UserX className="w-5 h-5 text-gray-500" />
              Deactivate {customer?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This marks them as inactive so they don't show in your active customer list. Nothing is deleted — all their invoices, estimates, and history stay intact. You can reactivate them any time by clicking the Inactive badge.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-deactivate-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                toggleActiveMutation.mutate(false);
                setDeactivateConfirmOpen(false);
              }}
              className="bg-gray-600 hover:bg-gray-700"
              data-testid="button-deactivate-confirm"
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}