import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { generateMaterialList, analyzeEstimateCompleteness } from "@/lib/functions";
import MissingPurchaseMaterials from "@/components/estimates/MissingPurchaseMaterials";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { downloadXactimateExcel } from "@/utils/xactimateExport";
import { normalizeSavedLineItem, sumNetAcv, sumRcv } from "@/utils/estimateTotals";
import {
  applyPerLineOverheadProfit,
  calculatePerLineOverheadProfit,
  getOpLineType,
  hasPerLineOverheadProfit,
  removePerLineOverheadProfit,
  updateEstimateOverheadProfit,
} from "@/utils/estimateOpLineItems";
import { buildEstimateSmsMessage, resolveSmsPhone } from "@/utils/documentSms";
import { downloadEsxFile, generateSymbilityXml, triggerXmlDownload, ESX_BETA_NOTE } from "@/utils/esxExport";
import {
  generateXactimateHTML,
  generateSymbilityHTML,
  validateInsuranceEstimateData,
  resolveOverheadProfitPercentages,
} from "@/utils/insuranceEstimateTemplates";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Save,
  Send,
  Download,
  ArrowLeft,
  Plus,
  Trash2,
  FileText,
  Sparkles,
  History,
  Eye,
  ClipboardList,
  MoreVertical,
  Upload,
  ShoppingCart,
  Loader2,
  DollarSign,
  HardHat,
  Shield,
  Mic,
  Wand2,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Copy,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  AlertTriangle,
  Search,
  Pencil,
  Paperclip,
  MessageSquare,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import LineItemEditor from "../components/estimates/LineItemEditor";
import DocumentPickerDialog from "../components/estimates/DocumentPickerDialog";
import VoiceNoteButton from "../components/VoiceNoteButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { localToday } from "@/utils/localDate";
import { findStaffRecipient, getStaffDisplayName, getStaffEmail, isValidRecipientEmail } from "@/utils/productionRecipient";
import { getMissingEstimateItems } from "@/utils/missingEstimateItems";
import useHiddenFeatures from "@/hooks/useHiddenFeatures";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import {
  buildSupplementCopyData,
  CHANGE_ORDER_APPROVED,
  CHANGE_ORDER_REJECTED,
  newChangeOrderFields,
  isChangeOrder,
  changeOrderStatus,
  changeOrderDiff,
  changeOrderDeltaCents,
  formatCents,
  formatCentsSigned,
  lineItemCents,
} from "@/lib/changeOrders";
import ChangeOrderBadge from "@/components/estimates/ChangeOrderBadge";
import ReviseEstimateDialog, { aiEstimatorEditSearch } from "@/components/estimates/ReviseEstimateDialog";

const cleanContactValue = (value) => {
  if (value == null) return '';
  const cleaned = String(value).trim();
  return /^(null|undefined)$/i.test(cleaned) ? '' : cleaned;
};

const getContactAddress = (contact) => {
  const directAddress = [contact?.address, contact?.property_address]
    .map(cleanContactValue)
    .find(Boolean) || '';
  if (directAddress) return directAddress;

  const street = cleanContactValue(contact?.street);
  const city = cleanContactValue(contact?.city);
  const state = cleanContactValue(contact?.state);
  const zip = cleanContactValue(contact?.zip);
  const stateAndZip = [state, zip].filter(Boolean).join(' ');

  return [street, city, stateAndZip].filter(Boolean).join(', ');
};

export default function EstimateEditor() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const HIDDEN_FEATURES = useHiddenFeatures();

  const urlParams = new URLSearchParams(location.search);
  const estimateId = urlParams.get('estimate_id');

  const [user, setUser] = useState(null);
  // Approving a change order raises what the homeowner is billed, so it is an
  // administrator/owner action. The server enforces this too; the flag here
  // only keeps the controls from appearing to people who can't use them.
  // Deliberately requires the signed-in identity to have RESOLVED — an approval
  // recorded before auth.me() lands would name nobody.
  const { isAdmin, isPermissionsReady } = useRoleBasedData();
  const canDecideChangeOrder = Boolean(isAdmin && isPermissionsReady && user?.email);
  const [lineItems, setLineItems] = useState([]);
  const [isExporting, setIsExporting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [viewingVersion, setViewingVersion] = useState(null);
  const [selectedContactId, setSelectedContactId] = useState(null);
  const [selectedContactType, setSelectedContactType] = useState(null); // 'customer' or 'lead'
  const [showCreateContactDialog, setShowCreateContactDialog] = useState(false);
  const [showSupplementConfirm, setShowSupplementConfirm] = useState(false);
  const [showChangeOrderDetail, setShowChangeOrderDetail] = useState(true);
  const [contactSearch, setContactSearch] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [allowCustomerEdit, setAllowCustomerEdit] = useState(false);
  const [showABCOrderDialog, setShowABCOrderDialog] = useState(false);
  const [showMaterialList, setShowMaterialList] = useState(false);
  const [materialListData, setMaterialListData] = useState(null);
  const [isGeneratingMaterials, setIsGeneratingMaterials] = useState(false);
  const [materialListTab, setMaterialListTab] = useState('order');
  // These belong to the Material Purchase List dialog, not the estimate itself.
  // Keep them initialized even before materialListData arrives: the dialog's
  // grouping and CSV paths render immediately when it opens.
  const [extraMaterialItems, setExtraMaterialItems] = useState([]);
  const [newExtraItem, setNewExtraItem] = useState({
    description: '',
    quantity: 1,
    unit: 'EA',
    trade: 'Roofing',
  });
  const [isReviewing, setIsReviewing] = useState(false);
  const [showAiReviewDialog, setShowAiReviewDialog] = useState(false);
  const [aiReviewData, setAiReviewData] = useState(null);
  const [showMissingDialog, setShowMissingDialog] = useState(false);
  const [missingItems, setMissingItems] = useState([]);
  const [missingScope, setMissingScope] = useState('general');
  const [vendorOverrides, setVendorOverrides] = useState({});
  const [showProductionDialog, setShowProductionDialog] = useState(false);
  const [productionEmail, setProductionEmail] = useState('');
  const [productionNote, setProductionNote] = useState('');
  const [isSendingProduction, setIsSendingProduction] = useState(false);
  const [showAdjusterDialog, setShowAdjusterDialog] = useState(false);
  const [adjusterName, setAdjusterName] = useState('');
  const [adjusterEmail, setAdjusterEmail] = useState('');
  const [adjusterClaimNumber, setAdjusterClaimNumber] = useState('');
  const [adjusterNote, setAdjusterNote] = useState('');
  const [isSendingAdjuster, setIsSendingAdjuster] = useState(false);
  const [adjusterPanelCollapsed, setAdjusterPanelCollapsed] = useState(false);
  const [expandedReviewIds, setExpandedReviewIds] = useState(new Set());
  const [adjusterIncludeReview, setAdjusterIncludeReview] = useState(true);
  const [adjusterAttachClaimsDefense, setAdjusterAttachClaimsDefense] = useState(false);
  const [abcOrderData, setAbcOrderData] = useState({
    branchNumber: '',
    deliveryDate: '',
    comments: ''
  });
  const [formData, setFormData] = useState({
          customer_name: "",
          customer_email: "",
          customer_phone: "",
          property_address: "",
          reference_number: "",
          insurance_company: "",
          adjuster_name: "",
          adjuster_phone: "",
          claim_number: "",
          policy_number: "",
          date_of_loss: "",
          date_inspected: "",
          type_of_loss: "",
          price_list: "",
          deductible: "",
          notes: "",
          attached_documents: [],
          status: "draft",
          valid_until: "",
          format_id: "",
          category: "",
          tags: [],
          discount_type: "none",
          discount_value: 0,
          adjustment_amount: 0,
          overhead_pct: null,
          profit_pct: null,
          financing_enabled: false,
          show_as_proposal: false,
          material_options: [],
        });
  const [tagInput, setTagInput] = useState("");
  const [loadedEstimateId, setLoadedEstimateId] = useState(null);
  const [showVoiceEstimate, setShowVoiceEstimate] = useState(false);
  const [voiceEstimateText, setVoiceEstimateText] = useState('');
  const [isGeneratingFromVoice, setIsGeneratingFromVoice] = useState(false);
  const [voiceEstimateItems, setVoiceEstimateItems] = useState([]);
  const [voiceEstimateRefineText, setVoiceEstimateRefineText] = useState('');
  const [isRefiningVoice, setIsRefiningVoice] = useState(false);
  const [showDocPicker, setShowDocPicker] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany, allCompanyStaff = [] } = useCurrentCompany(user);

  const productionStaff = allCompanyStaff.filter((staff) => (
    getStaffDisplayName(staff) && getStaffEmail(staff)
  ));
  const selectProductionRecipient = (value) => {
    const staff = findStaffRecipient(productionStaff, value);
    setProductionEmail(staff ? getStaffEmail(staff) : value);
  };

  const { data: estimate, isLoading } = useQuery({
    queryKey: ['estimate', estimateId],
    queryFn: async () => {
      if (!estimateId) return null;
      const results = await base44.entities.Estimate.filter({ id: estimateId });
      return results[0] || null;
    },
    enabled: !!estimateId,
  });

  const { data: estimateVersions = [] } = useQuery({
    queryKey: ['estimate-versions', estimateId],
    queryFn: () => estimateId ? base44.entities.EstimateVersion.filter({ estimate_id: estimateId }, '-version_number') : [],
    enabled: !!estimateId,
  });

  const { data: customFormats = [] } = useQuery({
    queryKey: ['custom-formats', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.EstimateFormat.filter({ is_active: true, company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, '-created_date', 1000) : [],
    enabled: !!myCompany,
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, '-created_date', 1000) : [],
    enabled: !!myCompany,
  });

  const { data: integrationSettings = [] } = useQuery({
    queryKey: ['integration-settings'],
    queryFn: () => myCompany ? base44.entities.IntegrationSetting.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const abcSupplySetting = integrationSettings.find(s => s.integration_name === 'ABC Supply' && s.is_enabled);

  // NEW: Fetch specific linked customer to ensure we have their latest details (especially email)
  const { data: linkedCustomer } = useQuery({
    queryKey: ['linked-customer', estimate?.customer_id],
    queryFn: async () => {
      if (!estimate?.customer_id) return null;
      const res = await base44.entities.Customer.filter({ id: estimate.customer_id });
      return res[0];
    },
    enabled: !!estimate?.customer_id,
  });

  // NEW: Fetch specific linked lead
  const { data: linkedLead } = useQuery({
    queryKey: ['linked-lead', estimate?.lead_id],
    queryFn: async () => {
      if (!estimate?.lead_id) return null;
      const res = await base44.entities.Lead.filter({ id: estimate.lead_id });
      return res[0];
    },
    enabled: !!estimate?.lead_id,
  });

  const { data: adjusterReviews = [], refetch: refetchAdjusterReviews } = useQuery({
    queryKey: ['adjuster-reviews', estimateId],
    queryFn: () => estimateId ? base44.entities.EstimateLineReview.filter({ estimate_id: estimateId }, '-created_date') : [],
    enabled: !!estimateId,
  });

  // The change order's parent is fetched by id rather than pulled out of the
  // customer chain pool: an estimate written against a lead (or with no contact
  // linked yet) never lands in that pool, and the diff must still work there.
  const { data: parentEstimate } = useQuery({
    queryKey: ['parent-estimate', estimate?.supplement_of],
    queryFn: async () => {
      const res = await base44.entities.Estimate.filter({ id: estimate.supplement_of });
      return res[0] || null;
    },
    enabled: !!estimate?.supplement_of,
  });

  const isInSupplementChain = !!(estimate?.supplement_of || estimate?.has_supplement_id);
  const { data: customerChainEstimates = [] } = useQuery({
    queryKey: ['customer-chain-estimates', estimate?.customer_id],
    queryFn: () => base44.entities.Estimate.filter({ customer_id: estimate.customer_id }, 'created_date', 200),
    enabled: !!(estimate?.customer_id && isInSupplementChain),
  });

  const revisionChain = React.useMemo(() => {
    if (!estimate) return [];
    const pool = customerChainEstimates.length > 0 ? customerChainEstimates : [estimate];
    const byId = {};
    pool.forEach(e => { byId[e.id] = e; });
    byId[estimate.id] = estimate;

    let root = estimate;
    const visited = new Set();
    while (root.supplement_of && byId[root.supplement_of] && !visited.has(root.supplement_of)) {
      visited.add(root.supplement_of);
      root = byId[root.supplement_of];
    }

    const chain = [];
    let cur = root;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push(cur);
      cur = cur.has_supplement_id ? byId[cur.has_supplement_id] : null;
    }
    return chain.length > 1 ? chain : [];
  }, [estimate, customerChainEstimates]);

  // The change order compares its SAVED line items against the parent's saved
  // line items. Both sides use the stored RCV — a carrier's rounded or $0 lines
  // would otherwise read as repriced every single time.
  const changeOrderComparison = React.useMemo(() => {
    if (!isChangeOrder(estimate) || !parentEstimate) return null;
    return {
      diff: changeOrderDiff(estimate, parentEstimate),
      deltaCents: changeOrderDeltaCents(estimate, parentEstimate),
    };
  }, [estimate, parentEstimate]);

  // Sync missing data from linked contact
  useEffect(() => {
    if (!estimate) return;

    const contact = linkedCustomer || linkedLead;
    if (contact) {
      setFormData(prev => {
        // Only update fields that are missing in the estimate/current form
        // But if the estimate has them, we usually respect the estimate's snapshot.
        // However, user specifically wants "sync from profile". 
        // If the email in form is empty, definitely fill it.
        const newName = prev.customer_name || cleanContactValue(contact.name || contact.full_name || contact.company);
        const newEmail = prev.customer_email || cleanContactValue(contact.email);
        const newPhone = prev.customer_phone || cleanContactValue(contact.phone);
        
        // Address parsing
        const address = prev.property_address || getContactAddress(contact);

        const newIns = prev.insurance_company || cleanContactValue(contact.insurance_company);
        const newClaim = prev.claim_number || cleanContactValue(contact.claim_number);
        const newAdjName = prev.adjuster_name || cleanContactValue(contact.adjuster_name);
        const newAdjPhone = prev.adjuster_phone || cleanContactValue(contact.adjuster_phone);
        const newPolicyNumber = prev.policy_number || cleanContactValue(contact.policy_number);

        // Only trigger update if something changed
        if (
          newName !== prev.customer_name ||
          newEmail !== prev.customer_email ||
          newPhone !== prev.customer_phone ||
          address !== prev.property_address ||
          newIns !== prev.insurance_company ||
          newClaim !== prev.claim_number ||
          newAdjName !== prev.adjuster_name ||
          newAdjPhone !== prev.adjuster_phone ||
          newPolicyNumber !== prev.policy_number
        ) {
          return {
            ...prev,
            customer_name: newName,
            customer_email: newEmail,
            customer_phone: newPhone,
            property_address: address,
            insurance_company: newIns,
            claim_number: newClaim,
            adjuster_name: newAdjName,
            adjuster_phone: newAdjPhone,
            policy_number: newPolicyNumber
          };
        }
        return prev;
      });
    }
  }, [estimate, linkedCustomer, linkedLead]);

  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const customer_name = urlParams.get('customer_name');
    const customer_email = urlParams.get('customer_email');
    const customer_phone = urlParams.get('customer_phone');
    const property_address = urlParams.get('property_address');
    const insurance_company = urlParams.get('insurance_company');
    const claim_number = urlParams.get('claim_number');

    if (!estimate && customer_name) {
      setFormData(prev => ({
        ...prev,
        customer_name: customer_name || prev.customer_name,
        customer_email: customer_email || prev.customer_email,
        customer_phone: customer_phone || prev.customer_phone,
        property_address: property_address || prev.property_address,
        insurance_company: insurance_company || prev.insurance_company,
        claim_number: claim_number || prev.claim_number,
      }));
    }
  }, [location.search, estimate, customers, leads]);

  useEffect(() => {
    if (estimate && estimate.id !== loadedEstimateId) {
      console.log("🔄 Initializing form data from estimate:", estimate.estimate_number);
      let validUntil = estimate.valid_until;
      if (!validUntil && estimate.created_date) {
        const createdDate = new Date(estimate.created_date);
        createdDate.setDate(createdDate.getDate() + 30);
        validUntil = createdDate.toISOString().split('T')[0];
      } else if (!validUntil) {
        const today = new Date();
        today.setDate(today.getDate() + 30);
        validUntil = today.toISOString().split('T')[0];
      }

      setFormData({
        customer_name: cleanContactValue(estimate.customer_name),
        customer_email: cleanContactValue(estimate.customer_email),
        customer_phone: cleanContactValue(estimate.customer_phone),
        property_address: cleanContactValue(estimate.property_address),
        reference_number: estimate.reference_number || "",
        insurance_company: cleanContactValue(estimate.insurance_company),
        adjuster_name: cleanContactValue(estimate.adjuster_name),
        adjuster_phone: cleanContactValue(estimate.adjuster_phone),
        claim_number: cleanContactValue(estimate.claim_number),
        policy_number: estimate.policy_number || "",
        date_of_loss: estimate.date_of_loss || estimate.damage_date || "",
        date_inspected: estimate.date_inspected || "",
        type_of_loss: estimate.type_of_loss || estimate.damage_type || "",
        price_list: estimate.price_list || "",
        deductible: estimate.deductible ?? "",
        notes: estimate.notes || "",
        attached_documents: estimate.attached_documents || [],
        status: estimate.status || "draft",
        valid_until: validUntil,
        format_id: estimate.format_id || "",
        category: estimate.category || "",
        tags: estimate.tags || [],
        discount_type: estimate.discount_type || "none",
        discount_value: Number(estimate.discount_value) || 0,
        adjustment_amount: Number(estimate.adjustment_amount) || 0,
        overhead_pct: estimate.overhead_pct ?? null,
        profit_pct: estimate.profit_pct ?? null,
        financing_enabled: estimate.financing_enabled || false,
        show_as_proposal: estimate.show_as_proposal || false,
        material_options: estimate.material_options || [],
      });

      if (estimate.customer_id) {
        setSelectedContactId(estimate.customer_id);
        setSelectedContactType('customer');
      } else if (estimate.lead_id) {
        setSelectedContactId(estimate.lead_id);
        setSelectedContactType('lead');
      } else {
        setAllowCustomerEdit(true);
      }

      // Revisions/supplements are drafts meant to be edited (e.g. corrected
      // customer/property details) before sending, so unlock customer fields
      // by default instead of requiring the buried "Edit Customer Info" toggle.
      // For any other linked estimate, reset the unlock so navigating between
      // estimates (e.g. via the supplement chain links) without a full remount
      // doesn't leave a previous estimate's unlocked state stuck on this one.
      if (estimate.supplement_of) {
        setAllowCustomerEdit(true);
      } else if (estimate.customer_id || estimate.lead_id) {
        setAllowCustomerEdit(false);
      }
      
      const items = estimate.line_items || estimate.items || [];
      // Load the SAVED figures as they were written. On a carrier document the RC
      // column is the authority and legitimately differs from quantity x rate --
      // the carrier rounds unit prices, and some carriers fold material tax into
      // each line. Recomputing here silently changed the estimate the moment it
      // was reopened: the total in the list and the total in the editor
      // disagreed, and saving wrote the recomputed figure over the real one.
      // Editing quantity or rate still recalculates that line (LineItemEditor's
      // handleCellChange); untouched lines keep exactly what was saved.
      const loadedItems = items.map(normalizeSavedLineItem);

      setLineItems(loadedItems);
      setLoadedEstimateId(estimate.id);
    }
  }, [estimate]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      // Read exactly the way the list, the customer view and every export read it.
      const hasExplicitOpLines = lineItems.some(item => getOpLineType(item));
      const { overhead_pct, profit_pct } = resolveOverheadProfitPercentages(
        { ...estimate, ...data },
        currentFormat || {},
      );
      const formatHasOp = currentFormat?.show_overhead_profit === true || currentFormat?.show_op_column === true;
      const persistedLineItems = formatHasOp
        ? applyPerLineOverheadProfit(lineItems, {
            overheadPct: overhead_pct,
            profitPct: profit_pct,
            taxRate: Number(currentFormat?.tax_rate) || 0,
          }).items
        : removePerLineOverheadProfit(lineItems);
      const detailItems = persistedLineItems.filter(item => !getOpLineType(item));
      const persistedHasExplicitOpLines = persistedLineItems.some(item => getOpLineType(item));
      const perLineFinancials = formatHasOp
        ? detailItems.map(item => calculatePerLineOverheadProfit(item, {
            overheadPct: overhead_pct,
            profitPct: profit_pct,
            taxRate: Number(currentFormat?.tax_rate) || 0,
          }))
        : [];
      const subtotal = formatHasOp
        ? perLineFinancials.reduce((sum, financials) => sum + financials.base, 0)
        : hasExplicitOpLines
          ? sumRcv(detailItems)
          : sumRcv(persistedLineItems);
      const taxTotal = formatHasOp
        ? perLineFinancials.reduce((sum, financials) => sum + financials.tax, 0)
        : 0;
      const overheadProfit = persistedHasExplicitOpLines
        ? sumRcv(persistedLineItems.filter(item => getOpLineType(item)))
        : formatHasOp
          ? perLineFinancials.reduce((sum, financials) => sum + financials.op, 0)
          : subtotal * (
              Math.max(0, Number(overhead_pct) || 0) +
              Math.max(0, Number(profit_pct) || 0)
            ) / 100;

      let discount = 0;
      if (data.discount_type === "percentage") {
        discount = subtotal * (data.discount_value / 100);
      } else if (data.discount_type === "fixed") {
        discount = data.discount_value;
      }
      
      const afterDiscount = subtotal - discount;
      const totalAmount = afterDiscount + taxTotal + overheadProfit + (data.adjustment_amount || 0);
      
      let updatedEstimate;
      if (estimateId) {
        // Updating existing estimate
        updatedEstimate = await base44.entities.Estimate.update(estimateId, {
          ...data,
          items: persistedLineItems,
          line_items: persistedLineItems,
          amount: totalAmount,
          total_amount: totalAmount
        });
      } else {
        // Creating new estimate
        updatedEstimate = await base44.entities.Estimate.create({
          ...data,
          company_id: myCompany?.id,
          items: persistedLineItems,
          line_items: persistedLineItems,
          amount: totalAmount,
          total_amount: totalAmount
        });
        // Update URL to reflect new estimate
        if (updatedEstimate?.id) {
          window.history.replaceState({}, '', `${createPageUrl('EstimateEditor')}?estimate_id=${updatedEstimate.id}`);
        }
      }

      try {
        const currentVersions = estimateVersions.filter(v => v.is_current);
        for (const version of currentVersions) {
          await base44.entities.EstimateVersion.update(version.id, { is_current: false });
        }

        const nextVersionNumber = estimateVersions.length > 0 ? estimateVersions[0].version_number + 1 : 1;
        
        const newVersionData = {
          estimate_id: estimateId,
          estimate_number: estimate?.estimate_number || '',
          version_number: nextVersionNumber,
          snapshot_data: {
            customer_name: data.customer_name || '',
            customer_email: data.customer_email || '',
            property_address: data.property_address || '',
            items: persistedLineItems || [],
            amount: totalAmount || 0,
            total_rcv: totalAmount || 0,
            total_acv: sumNetAcv(persistedLineItems, estimate?.acv_adjustment_amount),
            notes: data.notes || '',
            claim_number: data.claim_number || '',
            insurance_company: data.insurance_company || '',
            discount_type: data.discount_type || 'none',
            discount_value: data.discount_value || 0,
            adjustment_amount: data.adjustment_amount || 0,
          },
          change_description: 'Saved changes to estimate',
          changed_by: user?.email || 'unknown',
          is_current: true
        };
        
        await base44.entities.EstimateVersion.create(newVersionData);
      } catch (versionError) {
        console.warn('Failed to create version history:', versionError);
      }

      // Sync adjustment to linked invoice (if one exists)
      if (estimateId) {
        try {
          await base44.functions.invoke('syncEstimateAdjustmentToInvoice', {
            estimate_id: estimateId,
            new_total: totalAmount,
            adjustment_amount: data.adjustment_amount || 0
          });
        } catch (syncErr) {
          console.warn('[EstimateEditor] syncEstimateAdjustmentToInvoice failed (non-fatal):', syncErr);
        }
      }

      // Write insurance fields back to the linked customer/lead so they carry over to future estimates
      const hasInsuranceData = data.insurance_company || data.claim_number || data.adjuster_name || data.policy_number;
      const contactId = data.customer_id || (updatedEstimate?.customer_id);
      const leadId = data.lead_id || (updatedEstimate?.lead_id);
      if (hasInsuranceData && (contactId || leadId)) {
        const insuranceUpdate = {};
        if (data.insurance_company) insuranceUpdate.insurance_company = data.insurance_company;
        if (data.claim_number) insuranceUpdate.claim_number = data.claim_number;
        if (data.adjuster_name) insuranceUpdate.adjuster_name = data.adjuster_name;
        if (data.adjuster_phone) insuranceUpdate.adjuster_phone = data.adjuster_phone;
        if (data.policy_number) insuranceUpdate.policy_number = data.policy_number;
        try {
          if (contactId) {
            await base44.entities.Customer.update(contactId, insuranceUpdate);
          } else if (leadId) {
            await base44.entities.Lead.update(leadId, insuranceUpdate);
          }
        } catch (insuranceWriteErr) {
          console.warn('[EstimateEditor] Failed to write insurance fields back to contact (non-fatal):', insuranceWriteErr);
        }
      }

      return updatedEstimate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['estimate-versions', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      alert('✅ Estimate saved successfully!');
    },
    onError: (error) => {
        alert('❌ Failed to save estimate: ' + error.message);
    }
  });

  const restoreVersionMutation = useMutation({
    mutationFn: async (versionId) => {
      const versionToRestore = estimateVersions.find(v => v.id === versionId);
      if (!versionToRestore) throw new Error('Version not found');

      const snapshot = versionToRestore.snapshot_data;
      
      const updateData = {
        customer_name: snapshot.customer_name,
        customer_email: snapshot.customer_email,
        customer_phone: snapshot.customer_phone,
        property_address: snapshot.property_address,
        reference_number: snapshot.reference_number,
        insurance_company: snapshot.insurance_company,
        adjuster_name: snapshot.adjuster_name,
        adjuster_phone: snapshot.adjuster_phone,
        claim_number: snapshot.claim_number,
        notes: snapshot.notes,
        status: snapshot.status,
        valid_until: snapshot.valid_until,
        format_id: snapshot.format_id,
        category: snapshot.category,
        items: snapshot.items,
        amount: snapshot.amount,
      };

      await base44.entities.Estimate.update(estimateId, updateData);

      const currentVersions = estimateVersions.filter(v => v.is_current);
      for (const version of currentVersions) {
        await base44.entities.EstimateVersion.update(version.id, { is_current: false });
      }

      const nextVersionNumber = estimateVersions.length > 0 ? estimateVersions[0].version_number + 1 : 1;
      await base44.entities.EstimateVersion.create({
        estimate_id: estimateId,
        estimate_number: estimate?.estimate_number,
        version_number: nextVersionNumber,
        snapshot_data: snapshot,
        change_description: `Restored to Version ${versionToRestore.version_number} (${versionToRestore.change_description})`,
        changed_by: user?.email,
        is_current: true
      });

      return versionToRestore;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['estimate-versions', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      setShowVersionHistory(false);
      alert('✅ Version restored successfully! Please save any further changes if you want to keep them.');
    },
    onError: (error) => {
        alert('❌ Failed to restore version: ' + error.message);
    }
  });

  const sendMutation = useMutation({
    mutationFn: async (payload) => {
      const { currentFormData, currentLineItems, currentEstimate, currentContactId, currentContactType, currentCompany, currentFormat, currentPdfStyle, currentShowAsProposal } = payload;

      if (!currentCompany) {
        throw new Error("Please set up your company profile first!");
      }

      let finalCustomerEmail = currentFormData.customer_email;
      if (!finalCustomerEmail && currentContactId) {
        try {
          let contact;
          if (currentContactType === 'customer') {
            const res = await base44.entities.Customer.filter({ id: currentContactId });
            contact = res[0];
          } else if (currentContactType === 'lead') {
            const res = await base44.entities.Lead.filter({ id: currentContactId });
            contact = res[0];
          }
          if (contact && contact.email) {
            finalCustomerEmail = contact.email;
          }
        } catch (e) {
          console.error("Failed to auto-fetch customer email", e);
        }
      }

      if (!finalCustomerEmail) {
        throw new Error("Please enter customer email first!");
      }
      
      const subtotalRcv = currentLineItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
      const totalAcv = sumNetAcv(currentLineItems, currentEstimate?.acv_adjustment_amount);
      
      let discount = 0;
      if (currentFormData.discount_type === "percentage") {
        discount = subtotalRcv * (Number(currentFormData.discount_value) / 100);
      } else if (currentFormData.discount_type === "fixed") {
        discount = Number(currentFormData.discount_value) || 0;
      }
      
      const afterDiscount = subtotalRcv - discount;
      const sendOpRates = resolveOverheadProfitPercentages(
        { ...currentEstimate, ...currentFormData }, currentFormat || {},
      );
      const hasIncludedOp = currentLineItems.some(item => getOpLineType(item) || hasPerLineOverheadProfit(item));
      const sendOp = hasIncludedOp ? 0 : subtotalRcv * (
        Number(sendOpRates.overhead_pct) + Number(sendOpRates.profit_pct)
      ) / 100;
      const totalRcv = afterDiscount + sendOp + (Number(currentFormData.adjustment_amount) || 0);
      
      let pdfBase64 = null;
      const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
      try {
          const pdfResponse = await base44.functions.invoke('generateEstimatePDF', {
            estimate: {
              ...currentEstimate,
              ...currentFormData,
              line_items: currentLineItems,
              total_rcv: totalRcv,
              total_acv: totalAcv
            },
            customerInfo: {
              customer_name: currentFormData.customer_name,
              customer_email: finalCustomerEmail,
              customer_phone: currentFormData.customer_phone,
              property_address: currentFormData.property_address,
              insurance_company: currentFormData.insurance_company,
              claim_number: currentFormData.claim_number,
              policy_number: currentFormData.policy_number || currentEstimate?.policy_number,
              damage_type: currentFormData.damage_type || currentEstimate?.damage_type,
              damage_date: currentFormData.damage_date || currentEstimate?.damage_date,
              adjuster_name: currentFormData.adjuster_name || currentEstimate?.adjuster_name,
              adjuster_phone: currentFormData.adjuster_phone || currentEstimate?.adjuster_phone,
              insurance_phone: currentFormData.insurance_phone || currentEstimate?.insurance_phone,
              notes: currentFormData.notes
            },
            format: currentPdfStyle ? null : currentFormat,
            pdf_style: currentPdfStyle || undefined,
            show_as_proposal: currentShowAsProposal || false,
            returnBase64: true,
            impersonated_company_id: impersonatedId || undefined
          });

          if (pdfResponse?.base64 || pdfResponse?.data?.base64) {
            pdfBase64 = pdfResponse.base64 || pdfResponse.data.base64;
          }
      } catch (pdfError) {
          console.error("Failed to generate PDF for attachment:", pdfError);
      }
      
      const sendResult = await base44.functions.invoke('sendEstimateEmail', {
        to: finalCustomerEmail,
        customerName: currentFormData.customer_name,
        estimateData: {
          id: estimateId,
          estimate_number: currentEstimate?.estimate_number || 'DRAFT',
          estimate_title: currentEstimate?.estimate_title || 'Estimate',
          line_items: currentLineItems,
          total_rcv: totalRcv,
          total_acv: totalAcv,
          property_address: currentFormData.property_address,
          claim_number: currentFormData.claim_number,
          insurance_company: currentFormData.insurance_company,
          notes: currentFormData.notes,
          status: 'Sent',
        },
        format: currentFormat,
        pdfBase64: pdfBase64,
        companyId: currentCompany?.id
      });
      if (sendResult && (sendResult.error || sendResult.success === false)) {
        throw new Error(sendResult.error || 'Failed to send estimate email');
      }
      
      if (estimateId) {
          await base44.entities.Estimate.update(estimateId, { status: 'sent' });
      }
      
      try {
        await base44.functions.invoke('triggerWorkflow', {
          triggerType: 'estimate_sent',
          companyId: currentCompany.id,
          entityType: 'estimate',
          entityId: estimateId,
          entityData: {
            customer_name: currentFormData.customer_name,
            customer_email: finalCustomerEmail,
            customer_phone: currentFormData.customer_phone,
            estimate_number: currentEstimate?.estimate_number,
            amount: totalRcv,
            sender_name: user?.full_name || user?.name || ''
          }
        });
      } catch (workflowError) {
        console.warn('Workflow trigger failed:', workflowError.message);
      }

      try {
        const dueAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        await base44.entities.ActionItem.create({
          company_id: currentCompany?.id,
          type: 'follow_up_estimate',
          title: `Follow up: Estimate ${currentEstimate?.estimate_number || ''} sent to ${currentFormData.customer_name}`,
          description: `Estimate for $${totalRcv?.toFixed(2) || '0.00'} was sent. Follow up if no response within 48 hours.`,
          status: 'pending',
          priority: 'high',
          due_at: dueAt,
          related_estimate_id: estimateId || '',
          related_customer_id: currentContactType === 'customer' ? (currentContactId || '') : '',
          related_lead_id: currentContactType === 'lead' ? (currentContactId || '') : '',
          assigned_to: user?.email || '',
          created_by: 'system',
          escalation_level: 0,
        });
      } catch (aiErr) {
        console.warn('Action item creation failed:', aiErr.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      queryClient.invalidateQueries({ queryKey: ['action-items'] });
      alert('✅ Estimate email sent successfully!');
    },
    onError: (error) => {
      alert('❌ Failed to send estimate: ' + error.message);
    }
  });

  // Text the estimate instead of emailing it. Leads in particular often have a
  // phone number and no email, which used to make them unreachable from here.
  const sendSmsMutation = useMutation({
    mutationFn: async () => {
      const linkedContact = selectedContactId
        ? allContacts.find(c => c.id === selectedContactId)
        : null;
      const phone = resolveSmsPhone(formData.customer_phone, linkedContact?.phone);
      if (!phone) {
        throw new Error('No mobile number on this contact. Add a phone number first.');
      }
      if (!estimateId) {
        throw new Error('Save the estimate before texting it.');
      }

      // Signed public link so the estimate URL is not guessable. If signing is
      // unavailable we send the figures without a link rather than an unsigned
      // (and potentially unauthorized) URL.
      let shareUrl = '';
      try {
        const linkResp = await base44.functions.invoke('getEstimateShareLink', { id: estimateId });
        const url = linkResp?.data?.url || linkResp?.url;
        if (url) shareUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`;
      } catch (e) {
        console.warn('[EstimateEditor] getEstimateShareLink failed; texting without link:', e?.message);
      }

      const message = buildEstimateSmsMessage({
        estimate: {
          customer_name: formData.customer_name,
          estimate_number: estimate?.estimate_number,
          total_rcv: sumRcv(lineItems),
        },
        companyName: myCompany?.company_name,
        shareUrl,
      });

      const res = await base44.functions.invoke('sendSMS', {
        to: phone,
        message,
        contactName: formData.customer_name,
        companyId: myCompany?.id,
        manualSend: true,
      });
      const err = res?.error || res?.data?.error;
      if (err) throw new Error(err);

      // Only a not-yet-decided estimate advances to 'sent'. Re-texting a copy of
      // an estimate the customer already accepted (or that became a job) must
      // not walk its status backwards.
      const decided = ['accepted', 'approved', 'converted', 'declined', 'rejected'];
      if (!decided.includes(String(estimate?.status || '').toLowerCase())) {
        await base44.entities.Estimate.update(estimateId, { status: 'sent' });
      }
      return phone;
    },
    onSuccess: (phone) => {
      queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      toast.success(`Estimate texted to ${phone}`);
    },
    onError: (error) => {
      toast.error('Failed to text estimate: ' + error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Estimate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      alert('✅ Estimate deleted successfully!');
      navigate(createPageUrl('Estimates'));
    },
    onError: (error) => {
      alert('❌ Failed to delete estimate: ' + error.message);
    }
  });

  const convertToInvoiceMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('convertEstimateToInvoice', {
        estimate_id: estimate?.id,
        estimate_number: estimate?.estimate_number
      });
      if (response.error) throw new Error(response.error);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      alert('Invoice created as a draft. Review it and use Send Invoice to email the customer.');
      if (data?.invoice?.id) {
        navigate(createPageUrl('invoice-details') + '?id=' + data.invoice.id);
      }
    },
    onError: (error) => {
      alert('❌ Failed to convert estimate: ' + error.message);
    }
  });

  const placeABCOrderMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.functions.invoke('placeABCSupplyOrder', data);
    },
    onSuccess: (result) => {
      alert(`✅ Order placed! Confirmation #: ${result.data.confirmation_number}`);
      setShowABCOrderDialog(false);
      setAbcOrderData({ branchNumber: '', deliveryDate: '', comments: '' });
    },
    onError: (error) => {
      alert('❌ Failed to place order: ' + error.message);
    }
  });

  const handleOrderFromABC = () => {
    if (!abcSupplySetting) {
      alert('ABC Supply not connected. Go to Integration Manager to connect.');
      return;
    }
    
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + 3);
    
    setAbcOrderData({
      branchNumber: '',
      deliveryDate: deliveryDate.toISOString().split('T')[0],
      comments: `Materials for estimate ${estimate.estimate_number}`
    });
    setShowABCOrderDialog(true);
  };

  const createContactMutation = useMutation({
    mutationFn: async (contactData) => {
      if (contactData.type === 'customer') {
        return await base44.entities.Customer.create({
          company_id: myCompany?.id,
          name: contactData.name,
          email: contactData.email,
          phone: contactData.phone,
          street: contactData.street,
          city: contactData.city,
          state: contactData.state,
          zip: contactData.zip,
        });
      } else {
        return await base44.entities.Lead.create({
          company_id: myCompany?.id,
          name: contactData.name,
          email: contactData.email,
          phone: contactData.phone,
          street: contactData.street,
          city: contactData.city,
          state: contactData.state,
          zip: contactData.zip,
          status: 'new',
          source: 'manual',
        });
      }
    },
    onSuccess: (newContact, variables) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setSelectedContactId(newContact.id);
      setSelectedContactType(variables.type);
      setShowCreateContactDialog(false);
      alert(`✅ ${variables.type === 'customer' ? 'Customer' : 'Lead'} created successfully!`);
    },
  });

  const handleCreateSupplement = async ({ asChangeOrder = false, reason = '' } = {}) => {
    if (!estimate || !myCompany?.id) return;
    try {
      const allEsts = await base44.entities.Estimate.filter({ company_id: myCompany.id }, '-created_date', 500);
      const nums = (Array.isArray(allEsts) ? allEsts : [])
        .map(e => e.estimate_number)
        .filter(n => n?.startsWith('EST-'))
        .map(n => parseInt(n.replace(/EST-|[^0-9]/g, '')))
        .filter(n => !isNaN(n));
      const nextNum = nums.length > 0
        ? `EST-${(Math.max(...nums) + 1).toString().padStart(4, '0')}`
        : 'EST-0001';

      // Shared with the Estimates list create path so the two cannot drift: the
      // parent's identity, status, BOTH directions of its chain links and its
      // change-order approval are all dropped before the copy.
      const copyData = buildSupplementCopyData(estimate);

      const newEstimate = await base44.entities.Estimate.create({
        ...copyData,
        company_id: myCompany.id,
        estimate_number: nextNum,
        status: 'draft',
        supplement_of: estimate.id,
        supplement_of_number: estimate.estimate_number || '',
        ...(asChangeOrder ? newChangeOrderFields(reason) : {}),
      });
      await base44.entities.Estimate.update(estimate.id, {
        has_supplement: true,
        has_supplement_id: newEstimate.id,
        has_supplement_number: nextNum,
      });
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
      toast.success(
        asChangeOrder
          ? `Change order ${nextNum} created — pending approval`
          : `Supplement estimate ${nextNum} created`,
      );
      navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + newEstimate.id);
    } catch (err) {
      toast.error(`Failed to create ${asChangeOrder ? 'change order' : 'supplement'}: ` + err.message);
    }
  };

  // Internal office approval. Recorded on the change order itself so the
  // Estimates list, the customer profile and invoicing all read one state.
  const changeOrderDecisionMutation = useMutation({
    mutationFn: async (decision) => {
      if (!estimate?.id) throw new Error('No estimate loaded');
      if (!canDecideChangeOrder) throw new Error('Only company administrators can approve or reject a change order');
      // Only the decision travels. The approver's identity and the timestamp are
      // stamped server-side from the session, so the record can never name
      // someone other than the person who actually clicked (and never nobody).
      await base44.entities.Estimate.update(estimate.id, { change_order_status: decision });
      return decision;
    },
    onSuccess: (decision) => {
      queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      queryClient.invalidateQueries({ queryKey: ['customer-chain-estimates'] });
      toast.success(
        decision === CHANGE_ORDER_APPROVED
          ? 'Change order approved — it will be included when you invoice this customer'
          : 'Change order rejected — it stays out of invoicing',
      );
    },
    onError: (err) => toast.error('Could not record the decision: ' + err.message),
  });

  const handleSave = async () => {
    if (!formData.customer_name) {
      alert("Please enter a customer name");
      return;
    }

    let finalContactId = selectedContactId;
    let finalContactType = selectedContactType;
    
    const saveData = {
      ...formData,
      customer_id: finalContactId && finalContactType === 'customer' ? finalContactId : estimate?.customer_id,
      lead_id: finalContactId && finalContactType === 'lead' ? finalContactId : estimate?.lead_id,
      // Track creator only on new estimates (don't overwrite on update)
      ...(!estimateId ? {
        created_by_email: user?.email || '',
        created_by_name: user?.full_name || user?.name || '',
      } : {}),
    };
    
    saveMutation.mutate(saveData);
  };

  const handleSelectContact = (contact, type) => {
    setSelectedContactId(contact.id);
    setSelectedContactType(type);
    setContactSearch("");
    
    let street = "", city = "", state = "", zip = "";
    if (contact.street || contact.address) {
      const addr = contact.street || contact.address || "";
      street = addr;
      city = contact.city || "";
      state = contact.state || "";
      zip = contact.zip || "";
    }
    
    setFormData({
      ...formData,
      customer_name: contact.name || contact.company || "",
      customer_email: contact.email || "",
      customer_phone: contact.phone || "",
      property_address: street ? `${street}, ${city}, ${state} ${zip}`.trim() : "",
      insurance_company: contact.insurance_company || "",
      claim_number: contact.claim_number || "",
      adjuster_name: contact.adjuster_name || "",
      adjuster_phone: contact.adjuster_phone || "",
      policy_number: contact.policy_number || "",
    });
  };

  const allContacts = React.useMemo(() => {
    const contacts = [
      ...customers.map(c => ({ ...c, type: 'customer', displayName: c.name || c.company || c.email })),
      ...leads.map(l => ({ ...l, type: 'lead', displayName: l.name || l.company || l.email })),
    ];
    return contacts.filter(c => c.displayName).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [customers, leads]);

  const filteredContacts = React.useMemo(() => {
    if (!contactSearch) return allContacts;
    const search = contactSearch.toLowerCase();
    return allContacts.filter(c =>
      c.displayName?.toLowerCase().includes(search) ||
      c.email?.toLowerCase().includes(search) ||
      c.phone?.includes(search)
    );
  }, [allContacts, contactSearch]);

  const handleSendEstimate = async () => {
    sendMutation.mutate({
      currentFormData: formData,
      currentLineItems: lineItems,
      currentEstimate: estimate,
      currentContactId: selectedContactId,
      currentContactType: selectedContactType,
      currentCompany: myCompany,
      currentFormat: lineEditorFormat,
      currentPdfStyle: formData.format_id === '__professional_proposal__' ? 'professional_proposal' : undefined,
      currentShowAsProposal: formData.show_as_proposal || false
    });
  };

  const handleDeleteEstimate = () => {
    if (window.confirm("Are you sure you want to delete this estimate? This action cannot be undone.")) {
      if (estimateId) {
        deleteMutation.mutate(estimateId);
      }
    }
  };

  const handleExportToXactimate = async () => {
    if (!estimate?.id) { toast.error('No estimate loaded'); return; }
    const items = lineItems || estimate.items || [];
    if (items.length === 0) { toast.error('No line items to export'); return; }

    try {
      await downloadEsxFile(
        {
          ...estimate,
          customer_name:     estimate.customer_name    || formData.customer_name,
          property_address:  estimate.property_address || formData.property_address,
          insurance_company: estimate.insurance_company || formData.insurance_company,
        },
        items,
        myCompany || {},
        `${estimate.estimate_number || 'estimate'}.esx`
      );
      toast.info(ESX_BETA_NOTE, { duration: 12000 });
    } catch (err) {
      toast.error('ESX export failed: ' + err.message);
    }
  };

  const handleExportXactimateExcel = () => {
    const items = lineItems || estimate?.items || [];
    const est = estimate || {};
    downloadXactimateExcel(items, {
      customer_name: est.customer_name || formData.customer_name,
      property_address: est.property_address || formData.property_address,
      claim_number: est.claim_number,
      policy_number: est.policy_number,
      insurance_company: est.insurance_company || formData.insurance_company,
      adjuster_name: est.adjuster_name,
      estimate_number: est.estimate_number,
    }, est.estimate_number || 'estimate');
  };

  const handleExportToSymbility = () => {
    if (!estimate?.id) { alert('No estimate loaded'); return; }
    const items = lineItems || estimate.items || [];
    if (items.length === 0) { alert('No line items to export'); return; }

    // Shared generator enforces the Symbility ACV rule: per-item ACV = RCV,
    // depreciation subtracted only in <Totals><ACV>.
    const xml = generateSymbilityXml(
      {
        ...estimate,
        customer_name:     estimate.customer_name    || formData.customer_name,
        property_address:  estimate.property_address || formData.property_address,
        insurance_company: estimate.insurance_company || formData.insurance_company,
      },
      items,
      myCompany || {}
    );
    triggerXmlDownload(xml, `${estimate.estimate_number || 'estimate'}_symbility.xml`);
    alert('✅ Symbility XML file downloaded!');
  };

  const buildInsuranceTemplateData = () => {
    const items = lineItems || estimate?.items || [];
    const m = estimate?.data?.measurements || estimate?.measurements || estimate?.data || {};
    const { overhead_pct, profit_pct } = resolveOverheadProfitPercentages(
      { ...estimate, ...formData },
      currentFormat || {},
    );
    return {
      company: {
        company_name: myCompany?.company_name || myCompany?.name || '',
        address: myCompany?.address || [myCompany?.city, myCompany?.state, myCompany?.zip].filter(Boolean).join(', '),
        phone: myCompany?.phone || '',
        email: myCompany?.email || myCompany?.contact_email || '',
        contact_name: myCompany?.contact_name || '',
        license_number: myCompany?.license_number || '',
        logo_url: myCompany?.logo_url || '',
      },
      customer: {
        name: formData.customer_name ?? '',
        property_address: formData.property_address ?? '',
        phone: formData.customer_phone ?? '',
      },
      estimate: {
        estimate_number: estimate?.estimate_number || '',
        claim_number: formData.claim_number ?? '',
        policy_number: formData.policy_number ?? '',
        insurance_company: formData.insurance_company ?? '',
        insurance_address: formData.insurance_address ?? estimate?.insurance_address ?? '',
        type_of_loss: formData.type_of_loss ?? '',
        price_list: formData.price_list ?? '',
        deductible: formData.deductible || 0,
        date_of_loss: formData.date_of_loss ?? formData.damage_date ?? '',
        damage_date: formData.damage_date ?? formData.date_of_loss ?? '',
        date_inspected: formData.date_inspected ?? '',
        prepared_by: formData.adjuster_name || myCompany?.contact_name || '',
        section_label: estimate?.estimate_title || estimate?.estimate_number || 'Roof',
        overhead_pct,
        profit_pct,
        // Pass the user's adjustment so the exported RCV matches what EstimateEditor shows.
        adjustment_amount: Number(formData.adjustment_amount) || 0,
      },
      items,
      measurements: {
        surface_area_sqft: m.roof_area_sqft || m.surface_area_sqft,
        squares: m.roof_area_sq || m.squares,
        perimeter_lf: m.perimeter_lf,
        ridge_lf: m.ridge_lf,
        hip_lf: m.hip_lf,
        valley_lf: m.valley_lf,
        eave_lf: m.eave_lf,
        soffit_sqft: m.soffit_sqft,
      },
    };
  };

  const openPrintWindow = (html) => {
    const win = window.open('', '_blank');
    if (!win) { alert('Please allow pop-ups to open the print preview.'); return; }
    win.document.write(html);
    win.document.close();
  };

  const confirmInsuranceWarnings = (templateData) => {
    const warnings = validateInsuranceEstimateData(templateData);
    if (warnings.length === 0) return true;
    const msg =
      `The following issues were found in this estimate:\n\n` +
      warnings.map((w, i) => `${i + 1}. ${w}`).join('\n\n') +
      `\n\nPrint anyway?`;
    return window.confirm(msg);
  };

  const handlePrintXactimate = () => {
    if (!estimate?.id) { alert('No estimate loaded'); return; }
    const items = lineItems || estimate.items || [];
    if (items.length === 0) { alert('No line items to export'); return; }
    const templateData = buildInsuranceTemplateData();
    if (!confirmInsuranceWarnings(templateData)) return;
    openPrintWindow(generateXactimateHTML(templateData));
  };

  const handlePrintSymbility = () => {
    if (!estimate?.id) { alert('No estimate loaded'); return; }
    const items = lineItems || estimate.items || [];
    if (items.length === 0) { alert('No line items to export'); return; }
    const templateData = buildInsuranceTemplateData();
    if (!confirmInsuranceWarnings(templateData)) return;
    openPrintWindow(generateSymbilityHTML(templateData));
  };

  const handleDownloadPDF = async () => {
    if (!estimate?.id) {
      alert('No estimate loaded');
      return;
    }

    setIsDownloading(true);
    const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
    try {
      const response = await base44.functions.invoke('generateEstimatePDF', {
        estimate: {
          ...estimate,
          ...formData,
          line_items: lineItems,
          total_rcv: totalRcv,
           total_acv: sumNetAcv(lineItems, estimate?.acv_adjustment_amount)
        },
        customerInfo: {
          customer_name: formData.customer_name,
          customer_email: formData.customer_email,
          customer_phone: formData.customer_phone,
          property_address: formData.property_address,
          insurance_company: formData.insurance_company,
          claim_number: formData.claim_number,
          policy_number: formData.policy_number || estimate?.policy_number,
          damage_type: formData.damage_type || estimate?.damage_type,
          damage_date: formData.damage_date || estimate?.damage_date,
          adjuster_name: formData.adjuster_name || estimate?.adjuster_name,
          adjuster_phone: formData.adjuster_phone || estimate?.adjuster_phone,
          insurance_phone: formData.insurance_phone || estimate?.insurance_phone,
          notes: formData.notes
        },
        format: formData.format_id === '__professional_proposal__' ? null : lineEditorFormat,
        pdf_style: formData.format_id === '__professional_proposal__' ? 'professional_proposal' : undefined,
        show_as_proposal: formData.show_as_proposal || false,
        material_options: formData.material_options || [],
        returnBase64: true,
        impersonated_company_id: impersonatedId || undefined
      });

      const base64 = response?.base64 || response?.data?.base64;
      if (base64) {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${estimate.estimate_number || 'estimate'}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        alert('✅ PDF downloaded successfully!');
      } else {
        throw new Error('Invalid PDF response from server');
      }
    } catch (error) {
      console.error('Download error:', error);
      alert(`❌ Download failed: ${error.message}`);
    }
    setIsDownloading(false);
  };

  const handlePreviewEstimate = async () => {
    if (!estimate?.id) {
      alert('No estimate loaded');
      return;
    }

    setIsPreviewing(true);
    const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
    try {
      const response = await base44.functions.invoke('generateEstimatePDF', {
        estimate: {
          ...estimate,
          ...formData,
          line_items: lineItems,
          total_rcv: totalRcv,
           total_acv: sumNetAcv(lineItems, estimate?.acv_adjustment_amount)
        },
        customerInfo: {
          customer_name: formData.customer_name,
          customer_email: formData.customer_email,
          customer_phone: formData.customer_phone,
          property_address: formData.property_address,
          insurance_company: formData.insurance_company,
          claim_number: formData.claim_number,
          policy_number: formData.policy_number || estimate?.policy_number,
          damage_type: formData.damage_type || estimate?.damage_type,
          damage_date: formData.damage_date || estimate?.damage_date,
          adjuster_name: formData.adjuster_name || estimate?.adjuster_name,
          adjuster_phone: formData.adjuster_phone || estimate?.adjuster_phone,
          insurance_phone: formData.insurance_phone || estimate?.insurance_phone,
          notes: formData.notes
        },
        format: formData.format_id === '__professional_proposal__' ? null : lineEditorFormat,
        pdf_style: formData.format_id === '__professional_proposal__' ? 'professional_proposal' : undefined,
        show_as_proposal: formData.show_as_proposal || false,
        material_options: formData.material_options || [],
        returnBase64: true,
        impersonated_company_id: impersonatedId || undefined
      });

      const base64 = response?.base64 || response?.data?.base64;
      if (base64) {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        
        const url = window.URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => window.URL.revokeObjectURL(url), 100);
      } else {
        throw new Error('Invalid PDF response from server');
      }
    } catch (error) {
      console.error('Preview error:', error);
      alert(`❌ Preview failed: ${error.message}`);
    }
    setIsPreviewing(false);
  };

  const handleDownloadMaterialList = async () => {
    if (!lineItems || lineItems.length === 0) {
      alert('No line items to export');
      return;
    }

    const filteredItems = lineItems.filter(item => {
      const desc = (item.description || '').toLowerCase();
      return !desc.includes('tear out') && !desc.includes('tear off');
    });

    if (filteredItems.length === 0) {
      alert('No material items to export (all items are tear out/tear off)');
      return;
    }

    setIsDownloading(true);
    try {
      const response = await base44.functions.invoke('exportMaterialListExcel', {
        items: filteredItems,
        customerInfo: {
          customer_name: formData.customer_name,
          property_address: formData.property_address
        },
        estimateNumber: estimate.estimate_number,
        customerId: estimate.customer_id || selectedContactId,
        estimateId: estimate.id,
        saveToCustomer: true
      });

      console.log('Export response:', response);
      
      let blob;
      
      // Handle both base64 string and direct blob responses
      if (response?.data?.file || response?.file) {
        const fileData = response.data?.file || response.file;
        try {
          const binaryString = window.atob(fileData);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        } catch (decodeError) {
          console.error('Base64 decode error:', decodeError);
          // If atob fails, the response might already be binary data
          if (typeof fileData === 'object' && fileData instanceof Uint8Array) {
            blob = new Blob([fileData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          } else if (typeof fileData === 'string') {
            // Try to create blob from string directly
            blob = new Blob([fileData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          } else {
            throw new Error('Invalid file format: ' + typeof fileData);
          }
        }
      } else {
        throw new Error('No file data in response. Got: ' + JSON.stringify(response).substring(0, 200));
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.data.filename || `${estimate.estimate_number || 'estimate'}_material_list.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      alert('✅ Material list downloaded as Excel!');
    } catch (error) {
      console.error('Export error:', error);
      alert(`❌ Export failed: ${error.message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const buildVoiceEstimatePrompt = (description, { isRefine = false, existingItems = [], refineInstruction = '' } = {}) => {
    const ctx = [];
    if (formData.property_address) ctx.push(`Property: ${formData.property_address}`);
    if (formData.insurance_company) ctx.push(`Insurance: ${formData.insurance_company}`);
    if (formData.damage_type) ctx.push(`Damage type: ${formData.damage_type}`);
    if (formData.category) ctx.push(`Trade: ${formData.category}`);
    const squareItems = lineItems.filter(i => (i.unit || '').toUpperCase() === 'SQ' && i.quantity > 0);
    if (squareItems.length > 0) {
      const sq = squareItems[0].quantity;
      ctx.push(`Roof area: approximately ${sq} SQ from existing measurements`);
    }
    if (lineItems.length > 0 && !isRefine) {
      const cats = [...new Set(lineItems.map(i => i.category).filter(Boolean))];
      ctx.push(`Already on this estimate (do not duplicate): ${cats.join(', ')} (${lineItems.length} items)`);
    }
    const contextBlock = ctx.length ? `\nContext:\n${ctx.map(c => `- ${c}`).join('\n')}` : '';

    if (isRefine) {
      return `You are a roofing contractor's estimating assistant. You have a list of estimate line items and the contractor wants to refine them.

Original job description: "${description}"${contextBlock}

Current line items:
${existingItems.map((it, i) => `${i + 1}. ${it.description} — ${it.quantity} ${it.unit} @ $${it.unit_price} = $${it.rcv} [${it.category}]`).join('\n')}

Refinement instruction: "${refineInstruction}"

Return ONLY a valid JSON array representing the COMPLETE updated list (include unchanged items, modified items, new items; omit removed items). Same field schema:
[{"description":"...","quantity":0,"unit":"SQ","unit_price":0,"rcv":0,"category":"Roofing"}]`;
    }

    return `You are a senior roofing contractor's estimating assistant with 20 years of experience. Generate a complete, detailed estimate line item list based on the job description below.${contextBlock}

Job description: "${description}"

Rules:
- Use realistic 2025 pricing for the roofing industry
- Include ALL required items: materials, labor, removal, disposal, accessories, overhead
- Do NOT include items already on the estimate (if listed above)
- Quantities must be realistic given context (e.g. if roof area is known, use it)
- Use standard units: SQ (squares), LF (linear feet), EA (each), HR (hours), SF (sq ft)

Return ONLY a valid JSON array, no markdown, no explanation:
[{"description":"...","quantity":0,"unit":"SQ","unit_price":0,"rcv":0,"category":"Roofing"}]

Categories: Roofing, Gutters, Siding, Windows, Interior, Labor, Debris Removal, Overhead, Other`;
  };

  const parseVoiceResponse = (response, prefix = 'voice') => {
    let parsed = [];
    try {
      const raw = typeof response === 'string' ? response : JSON.stringify(response);
      const match = raw.match(/\[[\s\S]*\]/);
      parsed = match ? JSON.parse(match[0]) : JSON.parse(raw);
    } catch {
      parsed = Array.isArray(response) ? response : [];
    }
    return parsed.map((item, i) => ({
      id: `${prefix}_${Date.now()}_${i}`,
      description: item.description || '',
      quantity: Number(item.quantity) || 1,
      unit: item.unit || 'EA',
      unit_price: Number(item.unit_price) || 0,
      rcv: Number(item.rcv) || Math.round(Number(item.quantity || 1) * Number(item.unit_price || 0) * 100) / 100,
      acv: Number(item.acv) || 0,
      category: item.category || 'Other',
    }));
  };

  const handleVoiceToEstimate = async () => {
    if (!voiceEstimateText.trim()) return;
    setIsGeneratingFromVoice(true);
    setVoiceEstimateItems([]);
    try {
      const prompt = buildVoiceEstimatePrompt(voiceEstimateText);
      const response = await base44.integrations.Core.InvokeLLM({ prompt });
      setVoiceEstimateItems(parseVoiceResponse(response));
    } catch (err) {
      console.error('[VoiceToEstimate] error:', err);
      alert('Could not generate line items. Please try again.');
    } finally {
      setIsGeneratingFromVoice(false);
    }
  };

  const handleRefineVoiceEstimate = async () => {
    if (!voiceEstimateRefineText.trim() || voiceEstimateItems.length === 0) return;
    setIsRefiningVoice(true);
    try {
      const prompt = buildVoiceEstimatePrompt(voiceEstimateText, {
        isRefine: true,
        existingItems: voiceEstimateItems,
        refineInstruction: voiceEstimateRefineText,
      });
      const response = await base44.integrations.Core.InvokeLLM({ prompt });
      setVoiceEstimateItems(parseVoiceResponse(response, 'refine'));
      setVoiceEstimateRefineText('');
    } catch (err) {
      console.error('[RefineVoiceEstimate] error:', err);
      alert('Could not refine. Please try again.');
    } finally {
      setIsRefiningVoice(false);
    }
  };

  const handleUpdateVoiceItem = (idx, field, value) => {
    setVoiceEstimateItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      if (field === 'quantity' || field === 'unit_price') {
        updated.rcv = Math.round(Number(updated.quantity || 0) * Number(updated.unit_price || 0) * 100) / 100;
      }
      return updated;
    }));
  };

  const handleAddCustomVoiceItem = () => {
    setVoiceEstimateItems(prev => [...prev, {
      id: `custom_${Date.now()}`,
      description: '',
      quantity: 1,
      unit: 'EA',
      unit_price: 0,
      rcv: 0,
      acv: 0,
      category: 'Other',
    }]);
  };

  const handleAddVoiceItems = () => {
    const toAdd = voiceEstimateItems.filter(i => i.description.trim()).map(({ id, unit_price, ...item }) => ({
      ...item,
      rate: unit_price ?? 0,
      amount: item.rcv ?? 0,
    }));
    setLineItems(prev => [...prev, ...toAdd]);
    setShowVoiceEstimate(false);
    setVoiceEstimateText('');
    setVoiceEstimateItems([]);
    setVoiceEstimateRefineText('');
  };

  const handleGenerateMaterialList = async () => {
    if (!lineItems || lineItems.length === 0) {
      alert('No line items to generate material list from');
      return;
    }
    setIsGeneratingMaterials(true);
    const _mlToastId = toast.loading('Generating material list…');
    try {
      const tempEstimate = {
        items: lineItems,
        estimate_number: estimate?.estimate_number || 'DRAFT',
        customer_name: formData.customer_name,
        property_address: formData.property_address,
        job_type: estimate?.job_type || '',
        trade: estimate?.trade || '',
        category: estimate?.category || formData.category || '',
      };
      const response = await generateMaterialList({
        estimateId: estimate?.id || null,
        estimate: tempEstimate,
        jobType: tempEstimate.job_type,
        trade: tempEstimate.trade,
        category: tempEstimate.category,
      });
      if (!response || !response.success) {
        throw new Error(response?.error || 'Material list generation failed');
      }
      setMaterialListData(response);
      setShowMaterialList(true);
      // Fire-and-forget: persist to customer profile so it shows under Material Lists
      if (estimate?.customer_id && myCompany?.id) {
        base44.entities.MaterialList.create({
          customer_id: estimate.customer_id,
          company_id: myCompany.id,
          estimate_id: estimate?.id || null,
          estimate_number: estimate?.estimate_number || 'DRAFT',
          customer_name: formData.customer_name || '',
          property_address: formData.property_address || '',
          material_calculations: response.material_calculations || [],
          materials: response.materials || [],
          missing_materials: response.missing_materials || [],
          pricing_incomplete: response.pricing_incomplete || false,
          labor: response.labor || [],
          other: response.other || [],
          totals: response.totals || {},
          scope: response.scope || '',
          generated_at: new Date().toISOString(),
        }).catch(e => console.warn('[MaterialList] Auto-save to profile failed:', e.message));
      }
    } catch (error) {
      console.error('Material list error:', error);
      const msg = String(error?.message || '');
      const looksLikeHtmlResponse = /Unexpected token '?<'?|<!DOCTYPE|<html/i.test(msg);
      const looksLikeTimeout = /timeout|timed out|aborted|network/i.test(msg);
      let friendly;
      if (looksLikeHtmlResponse) {
        friendly = 'The server returned an error page instead of a material list. This usually means the request timed out on the server. Please try again — if it keeps failing, the estimate may have too many line items or there may be a temporary server issue.';
      } else if (looksLikeTimeout) {
        friendly = 'The material list took too long to generate and timed out. Please try again.';
      } else {
        friendly = `Failed to generate material list: ${msg}`;
      }
      toast.error(friendly, { id: _mlToastId });
    } finally {
      toast.dismiss(_mlToastId);
      setIsGeneratingMaterials(false);
    }
  };

  const handleAiReview = async () => {
    if (!lineItems || lineItems.length === 0) {
      toast.error('Add some line items first before running AI Review.');
      return;
    }
    setIsReviewing(true);
    const toastId = toast.loading('Reviewing estimate with AI…');
    try {
      const response = await analyzeEstimateCompleteness({
        lineItems,
        jobType: estimate?.job_type || 'roofing',
        roofPitch: formData?.pitch || estimate?.pitch,
        customerInfo: { name: formData?.customer_name, address: formData?.property_address }
      });
      if (response?.success) {
        setAiReviewData(response);
        setShowAiReviewDialog(true);
        toast.success('Review complete!', { id: toastId });
      } else {
        throw new Error(response?.error || 'Review failed');
      }
    } catch (err) {
      toast.error(`Review failed: ${err.message}`, { id: toastId });
    } finally {
      setIsReviewing(false);
    }
  };

  const handleAddReviewItem = (item) => {
    const qty = Number(item.typical_quantity) || 1;
    const rate = Number(item.typical_rate) || 0;
    const newItem = {
      line: lineItems.length + 1,
      code: item.suggested_code || '',
      description: item.item_description,
      quantity: qty,
      unit: item.typical_unit || 'EA',
      rate,
      rcv: rate * qty,
      acv: rate * qty,
      amount: rate * qty,
    };
    setLineItems(prev => [...prev, newItem]);
    setAiReviewData(prev => prev ? { ...prev, suggestions: prev.suggestions.filter(s => s !== item) } : prev);
    toast.success(`Added: ${item.item_description}`);
  };

  const handleCheckMissing = () => {
    if (!lineItems || lineItems.length === 0) {
      toast.error('Add some line items first.');
      return;
    }
    const result = getMissingEstimateItems({
      lineItems,
      estimate,
      formData,
    });
    setMissingScope(result.scope);
    setMissingItems(result.items);
    setShowMissingDialog(true);
  };

  const handleAddMissingItem = (item) => {
    const newItem = {
      line: lineItems.length + 1,
      code: '',
      description: item.label,
      quantity: 1,
      unit: 'EA',
      rate: 0,
      rcv: 0,
      acv: 0,
      amount: 0,
    };
    setLineItems(prev => [...prev, newItem]);
    setMissingItems(prev => prev.filter(m => m !== item));
    toast.success(`Added: ${item.label}`);
  };

  const matchCalc = (item, calcs) => calcs?.find(c => {
    const d = (item.description || item.name || '').toLowerCase();
    const m = (c.material || '').toLowerCase();
    if (d.includes('shingle') && !d.includes('cap') && !d.includes('starter') && m.includes('shingle') && !m.includes('cap') && !m.includes('starter')) return true;
    if ((d.includes('ridge') || d.includes('hip')) && (m.includes('ridge') || m.includes('hip'))) return true;
    if (d.includes('valley') && m.includes('valley')) return true;
    if ((d.includes('underlayment') || d.includes('felt') || d.includes('synthetic')) && (m.includes('underlayment') || m.includes('felt') || m.includes('synthetic'))) return true;
    if (d.includes('drip') && m.includes('drip')) return true;
    if (d.includes('nail') && m.includes('nail')) return true;
    if (d.includes('starter') && m.includes('starter')) return true;
    if ((d.includes('ice') || d.includes('water shield')) && m.includes('ice')) return true;
    if (d.includes('step') && d.includes('flashing') && m.includes('step')) return true;
    return false;
  });

  const calcOrderQty = (item, calcs) => {
    const desc = (item.description || item.name || '').toLowerCase();
    const qty = Number(item.quantity || 0);
    const unit = (item.unit || '').toUpperCase();
    // New deterministic material lists carry the answer on the precise source
    // product. Never run that product through the old fuzzy "Shingles" matcher:
    // it would apply the first generic shingles total to every shingle type.
    if (Number.isFinite(Number(item.order_quantity)) && Number(item.order_quantity) > 0) {
      return { qty: Number(item.order_quantity), unit: item.order_unit || item.unit, note: item.order_note || '' };
    }
    const calcMatch = matchCalc(item, calcs);
    if (calcMatch) {
      const rawQty = Number(calcMatch.quantity || 0);
      const rawUnit = (calcMatch.unit || '').toUpperCase();
      const purchaseUnit = calcMatch.purchaseUnit || calcMatch.unit || unit;
      const calcNote = calcMatch.notes || calcMatch.calculation || '';
      // The AI returns calc.quantity as the RAW measurement (SQ/LF/SF) with purchaseUnit set to the
      // packaged unit (bundle/roll/etc). Convert raw measurements into purchase units here.
      const isRaw = rawUnit === 'SQ' || rawUnit === 'LF' || rawUnit === 'SF';
      if (isRaw) {
        // Field shingles: 3 bundles per SQ
        if (desc.includes('shingle') && !desc.includes('cap') && !desc.includes('starter')) {
          const b = Math.ceil(rawQty * 3);
          return { qty: b, unit: 'bundle', note: `${rawQty.toFixed(2)} SQ × 3 = ${b} bundles` };
        }
        // Underlayment/felt/synthetic: roll covers 10 SQ
        if (desc.includes('underlayment') || desc.includes('felt') || desc.includes('synthetic')) {
          const r = Math.ceil(rawQty / 10);
          return { qty: r, unit: 'roll', note: `${rawQty.toFixed(2)} SQ ÷ 10 SQ/roll = ${r} rolls` };
        }
        // Ice & water shield: roll covers 50 LF (150 SF)
        if (desc.includes('ice') || desc.includes('water shield')) {
          const lf = rawUnit === 'SF' ? rawQty / 3 : rawQty;
          const r = Math.ceil(lf / 50);
          return { qty: r, unit: 'roll', note: `${lf.toFixed(2)} LF ÷ 50 LF/roll = ${r} rolls` };
        }
        // Ridge/hip cap: bundle covers 33 LF
        if ((desc.includes('ridge') || desc.includes('hip')) && desc.includes('cap')) {
          const b = Math.ceil(rawQty / 33);
          return { qty: b, unit: 'bundle', note: `${rawQty.toFixed(2)} LF ÷ 33 LF/bundle = ${b} bundles` };
        }
        // Starter strip: bundle covers 100 LF
        if (desc.includes('starter')) {
          const b = Math.ceil(rawQty / 100);
          return { qty: b, unit: 'bundle', note: `${rawQty.toFixed(2)} LF ÷ 100 LF/bundle = ${b} bundles` };
        }
        // Drip edge: 10-ft sticks
        if (desc.includes('drip')) {
          const p = Math.ceil(rawQty / 10);
          return { qty: p, unit: 'stick', note: `${rawQty.toFixed(2)} LF ÷ 10 ft/stick = ${p} sticks` };
        }
        // Valley metal: 10-ft sections
        if (desc.includes('valley')) {
          const p = Math.ceil(rawQty / 10);
          return { qty: p, unit: 'section', note: `${rawQty.toFixed(2)} LF ÷ 10 ft/section = ${p} sections` };
        }
        // Step flashing: box covers ~50 LF
        if (desc.includes('step') && desc.includes('flashing')) {
          const b = Math.ceil(rawQty / 50);
          return { qty: b, unit: 'box', note: `${rawQty.toFixed(2)} LF ÷ 50 LF/box = ${b} boxes` };
        }
        // Roofing nails: box covers ~15 SQ (matches functions/generateMaterialList.ts)
        if (desc.includes('nail')) {
          const b = Math.ceil(rawQty / 15);
          return { qty: b, unit: 'box', note: `${rawQty.toFixed(2)} SQ ÷ 15 SQ/box = ${b} boxes` };
        }
      }
      // calc.quantity is already in purchase units (or unrecognized). Prefer the line item's own
      // purchase quantity (materials array is already packaged) when it isn't a raw measurement.
      if (qty > 0 && unit !== 'SQ' && unit !== 'LF' && unit !== 'SF') {
        return { qty: Math.ceil(qty), unit: item.unit || purchaseUnit, note: calcNote };
      }
      // Unrecognized raw measurement with no conversion rule: show it honestly with its own
      // unit rather than mislabeling a raw number with a packaged unit.
      if (isRaw) return { qty: rawQty, unit: calcMatch.unit || rawUnit, note: calcNote };
      return { qty: Math.ceil(rawQty), unit: purchaseUnit, note: calcNote };
    }
    if (desc.includes('gutter') && !desc.includes('screen') && !desc.includes('downspout') && unit === 'LF') return { qty: Math.ceil(qty / 10), unit: '10-ft piece', note: `${qty} LF ÷ 10 ft sections` };
    if (desc.includes('downspout') && unit === 'LF') return { qty: Math.ceil(qty / 10), unit: '10-ft piece', note: `${qty} LF ÷ 10 ft sections` };
    if (desc.includes('screen') && unit === 'LF') return { qty: Math.ceil(qty / 4), unit: '4-ft piece', note: `${qty} LF ÷ 4 ft sections` };
    if ((desc.includes('siding') || (desc.includes('lap') && !desc.includes('overlap'))) && unit === 'SF') return { qty: Math.ceil(qty / 100), unit: 'SQ', note: `${qty} SF ÷ 100 = ${Math.ceil(qty / 100)} SQ` };
    if ((desc.includes('j-channel') || desc.includes('j channel')) && unit === 'LF') return { qty: Math.ceil(qty / 12), unit: '12-ft stick', note: `${qty} LF ÷ 12 ft sticks` };
    if (desc.includes('corner trim') && unit === 'LF') return { qty: Math.ceil(qty / 10), unit: '10-ft stick', note: `${qty} LF ÷ 10 ft sticks` };
    if (desc.includes('drip edge') && unit === 'LF') return { qty: Math.ceil(qty / 10), unit: '10-ft stick', note: `${qty} LF ÷ 10 ft sticks` };
    if ((desc.includes('wrap') && !desc.includes('house wrap') && !desc.includes('housewrap')) && unit === 'LF') return { qty: Math.ceil(qty / 50), unit: '50-ft coil', note: `${qty} LF ÷ 50 ft coils` };
    if (desc.includes('ridge vent') && unit === 'LF') return { qty: Math.ceil(qty / 4), unit: '4-ft piece', note: `${qty} LF ÷ 4 ft sections` };
    if ((desc.includes('house wrap') || desc.includes('housewrap') || desc.includes('vapor barrier') || desc.includes('shelter')) && unit === 'SF') return { qty: Math.ceil(qty / 1000), unit: 'roll', note: `${qty} SF ÷ ~1,000 SF/roll` };
    if ((desc.includes('felt') || desc.includes('15 lb')) && unit === 'SQ') return { qty: Math.ceil(qty / 10), unit: 'roll', note: `${qty} SQ ÷ 10 SQ/roll` };
    // Line item already in a discrete/purchase unit (EA, bundle, roll, box, etc.) — use it directly
    if (qty > 0 && unit !== 'SQ' && unit !== 'LF' && unit !== 'SF' && unit !== '') return { qty: Math.ceil(qty), unit: item.unit, note: '' };
    return null;
  };

  const getTradeGroup = (item) => {
    const desc = (item.description || item.name || '').toLowerCase();
    if (desc.includes('gutter') || desc.includes('downspout')) return 'Gutters & Downspouts';
    if (desc.includes('siding') || desc.includes('j-channel') || desc.includes('j channel') || desc.includes('corner trim') || desc.includes('house wrap') || desc.includes('housewrap') || desc.includes('vapor barrier') || desc.includes('shelter')) return 'Siding & Exterior';
    if (desc.includes('window') || desc.includes('door') || desc.includes('lockset') || desc.includes('wrap')) return 'Windows & Doors';
    if (desc.includes('deck') || desc.includes('decking') || desc.includes('railing')) return 'Deck';
    if (desc.includes('light fixture') || desc.includes('exterior light')) return 'Exterior Lighting';
    return 'Roofing';
  };

  const TRADE_COLORS = {
    'Roofing': 'bg-amber-100 text-amber-900',
    'Gutters & Downspouts': 'bg-blue-100 text-blue-900',
    'Siding & Exterior': 'bg-green-100 text-green-900',
    'Windows & Doors': 'bg-purple-100 text-purple-900',
    'Deck': 'bg-orange-100 text-orange-900',
    'Exterior Lighting': 'bg-yellow-100 text-yellow-900',
  };

  const downloadMaterialListCSV = () => {
    if (!materialListData) return;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;
    const calcs = materialListData.material_calculations || [];
    const materials = materialListData.materials || [];

    let csv = 'MATERIAL ORDER SHEET\r\n';
    csv += `Customer,${esc(materialListData.estimate?.customer_name)}\r\n`;
    csv += `Address,${esc(materialListData.estimate?.property_address)}\r\n`;
    csv += `Date,${esc(new Date().toLocaleDateString())}\r\n\r\n`;

    const TRADE_ORDER = ['Roofing', 'Gutters & Downspouts', 'Siding & Exterior', 'Windows & Doors', 'Deck', 'Exterior Lighting'];
    const grouped = {};
    materials.forEach(item => {
      const group = getTradeGroup(item);
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push(item);
    });
    extraMaterialItems.forEach(item => {
      const group = item.trade || 'Other';
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push(item);
    });
    const sortedGroups = Object.keys(grouped).sort((a, b) => {
      const ia = TRADE_ORDER.indexOf(a); const ib = TRADE_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    csv += 'Trade,Description,Ins. Qty,Unit,Order Qty,Order Unit,Notes\r\n';
    sortedGroups.forEach(group => {
      grouped[group].forEach(item => {
        if (item._extra) {
          csv += [
            esc(group),
            esc(item.description || ''),
            Number(item.quantity || 0).toFixed(2),
            esc(item.unit || ''),
            Number(item.quantity || 0).toFixed(2),
            esc(item.unit || ''),
            esc('Manually added'),
          ].join(',') + '\r\n';
          return;
        }
        const oq = calcOrderQty(item, calcs);
        csv += [
          esc(group),
          esc(item.description || item.name || ''),
          Number(item.quantity || 0).toFixed(2),
          esc(item.unit || ''),
          esc(oq ? oq.qty : ''),
          esc(oq ? oq.unit : ''),
          esc(oq ? oq.note : ''),
        ].join(',') + '\r\n';
      });
    });

    csv += '\r\nLABOR & SERVICES\r\n';
    csv += 'Description,Qty,Unit,Rate,Amount\r\n';
    (materialListData.labor || []).forEach(item => {
      csv += [
        esc(item.description || item.name || ''),
        Number(item.quantity || 0).toFixed(2),
        esc(item.unit || ''),
        `$${Number(item.rate || 0).toFixed(2)}`,
        `$${Number(item.amount || 0).toFixed(2)}`,
      ].join(',') + '\r\n';
    });

    const allItems = [
      ...(materialListData.materials || []).map(i => ({ ...i, _section: 'Material' })),
      ...(materialListData.labor || []).map(i => ({ ...i, _section: 'Labor' })),
      ...(materialListData.other || []).map(i => ({ ...i, _section: 'Other' })),
    ];
    if (allItems.length > 0) {
      csv += '\r\n';
    }

    csv += `Materials Total,$${Number(materialListData.totals?.materials || 0).toFixed(2)}\r\n`;
    csv += `Labor Total,$${Number(materialListData.totals?.labor || 0).toFixed(2)}\r\n`;
    csv += `Grand Total,$${Number(materialListData.totals?.grand_total || 0).toFixed(2)}\r\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${formData.customer_name || 'estimate'}_material_list.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const getFormatForSource = (formatId) => {
    if (!formatId) return null;
    return customFormats.find(f => f.id === formatId);
  };

  const currentFormat = React.useMemo(
    () => getFormatForSource(formData.format_id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formData.format_id, customFormats]
  );

  const handleEstimateFormatChange = (formatId) => {
    setFormData(prev => ({ ...prev, format_id: formatId }));
    const nextFormat = getFormatForSource(formatId);
    const formatHasOp = nextFormat?.show_overhead_profit === true || nextFormat?.show_op_column === true;
    if (formatHasOp) {
      const percentages = resolveOverheadProfitPercentages({ ...estimate, ...formData }, nextFormat);
      setLineItems(prev => applyPerLineOverheadProfit(prev, {
        overheadPct: percentages.overhead_pct,
        profitPct: percentages.profit_pct,
        taxRate: Number(nextFormat.tax_rate) || 0,
      }).items);
    } else {
      setLineItems(prev => removePerLineOverheadProfit(prev));
    }
  };

  const hasExplicitOpLines = lineItems.some(item => getOpLineType(item));
  const formatHasOp = currentFormat?.show_overhead_profit === true || currentFormat?.show_op_column === true;
  const { overhead_pct, profit_pct } = resolveOverheadProfitPercentages(
    { ...estimate, ...formData },
    currentFormat || {},
  );
  const opRate = (
    Math.max(0, Number(overhead_pct) || 0) +
    Math.max(0, Number(profit_pct) || 0)
  ) / 100;
  const handleOverheadProfitChange = (nextOverhead, nextProfit) => {
    const overhead = Math.max(0, Number(nextOverhead) || 0);
    const profit = Math.max(0, Number(nextProfit) || 0);
    setFormData(prev => ({ ...prev, overhead_pct: overhead, profit_pct: profit }));
    setLineItems(prev => updateEstimateOverheadProfit(prev, {
      overheadPct: overhead,
      profitPct: profit,
      format: currentFormat || {},
    }));
  };
  const lineEditorFormat = currentFormat ? {
    ...currentFormat,
    overhead_profit_rate: Number(overhead_pct) + Number(profit_pct),
    overhead_pct,
    profit_pct,
  } : null;
  const detailItems = lineItems.filter(item => !getOpLineType(item));
  const perLineFinancials = formatHasOp
    ? detailItems.map(item => calculatePerLineOverheadProfit(item, {
        overheadPct: overhead_pct,
        profitPct: profit_pct,
        taxRate: Number(currentFormat?.tax_rate) || 0,
      }))
    : [];
  const subtotal = formatHasOp
    ? perLineFinancials.reduce((sum, financials) => sum + financials.base, 0)
    : hasExplicitOpLines
      ? sumRcv(detailItems)
      : sumRcv(lineItems);
  const taxTotal = formatHasOp
    ? perLineFinancials.reduce((sum, financials) => sum + financials.tax, 0)
    : 0;

  let discount = 0;
  if (formData.discount_type === "percentage") {
    discount = subtotal * (Number(formData.discount_value) / 100);
  } else if (formData.discount_type === "fixed") {
    discount = Number(formData.discount_value) || 0;
  }
  
  const afterDiscount = subtotal - discount;
  const overheadProfit = hasExplicitOpLines
    ? sumRcv(lineItems.filter(item => getOpLineType(item)))
    : formatHasOp
      ? perLineFinancials.reduce((sum, financials) => sum + financials.op, 0)
      : subtotal * (
          Math.max(0, Number(overhead_pct) || 0) +
          Math.max(0, Number(profit_pct) || 0)
        ) / 100;
  const totalRcv = afterDiscount + taxTotal + overheadProfit + (Number(formData.adjustment_amount) || 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading estimate...</p>
        </div>
      </div>
    );
  }

  if (!estimate) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-red-600 mb-4">Estimate not found</p>
          <Button onClick={() => navigate(createPageUrl('Estimates'))}>
            Back to Estimates
          </Button>
        </div>
      </div>
    );
  }

  const openThisEstimateInAiEstimator = () => {
    const search = aiEstimatorEditSearch({
      customer_name: formData.customer_name || '',
      customer_email: formData.customer_email || '',
      customer_phone: formData.customer_phone || '',
      property_address: formData.property_address || '',
      insurance_company: formData.insurance_company || '',
      claim_number: formData.claim_number || '',
      adjuster_name: formData.adjuster_name || '',
      adjuster_phone: formData.adjuster_phone || '',
      id: estimate?.id,
      estimate_number: estimate?.estimate_number || '',
    });
    navigate(createPageUrl('AIEstimator') + '?' + search);
  };

  return (
    <div className="p-3 sm:p-6 space-y-6 bg-gray-50 min-h-screen min-w-0 w-full max-w-full">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between min-w-0">
        <div className="flex flex-wrap items-center gap-2 md:gap-4 min-w-0">
          <Button
            variant="outline"
            onClick={() => navigate(createPageUrl('Estimates'))}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Estimates
          </Button>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 min-w-0 break-words">
            {estimate.estimate_number || 'New Estimate'}
          </h1>
          <button
            type="button"
            data-testid="toggle-show-as-proposal"
            onClick={() => setFormData(prev => {
              const turningOn = !prev.show_as_proposal;
              return {
                ...prev,
                show_as_proposal: turningOn,
                // Activating proposal mode switches to the full professional
                // proposal format (cover page, aerial imagery, Why-Us page,
                // categorised scope of work). Deactivating restores standard.
                format_id: turningOn ? '__professional_proposal__' : '',
              };
            })}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors cursor-pointer select-none ${
              formData.show_as_proposal
                ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
                : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400 hover:text-indigo-600'
            }`}
            title={formData.show_as_proposal ? 'Click to switch back to standard Estimate format' : 'Click to switch to full Professional Proposal format (cover page, aerial imagery, scope of work)'}
          >
            <FileText className="w-3 h-3" />
            {formData.show_as_proposal ? 'PROPOSAL' : 'ESTIMATE'}
          </button>
          {estimateVersions.length > 0 && (
            <Badge variant="outline" className="gap-1">
              <History className="w-3 h-3" />
              v{estimateVersions.length}
            </Badge>
          )}
          {estimate?.supplement_of && (
            <>
              <ChangeOrderBadge estimate={estimate} />
              <button
                type="button"
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border transition-colors ${isChangeOrder(estimate) ? 'bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-200' : 'bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200'}`}
                title={`${isChangeOrder(estimate) ? 'Change order to' : 'Supplement of'} ${estimate.supplement_of_number || 'original'} — click to open original`}
                onClick={() => navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.supplement_of)}
                data-testid="badge-supp-of-header"
              >
                ↳ {isChangeOrder(estimate) ? 'CO to' : 'Supp of'} {estimate.supplement_of_number || '—'}
              </button>
            </>
          )}
          {estimate?.has_supplement && estimate?.has_supplement_id && (
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200 transition-colors"
              title={`1 supplement — click to open ${estimate.has_supplement_number || 'supplement'}`}
              onClick={() => navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.has_supplement_id)}
              data-testid="badge-supp-count-header"
            >
              1 supp
            </button>
          )}
          {estimate?.has_supplement && !estimate?.has_supplement_id && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">
              +SUPP
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <Button
            variant="outline"
            onClick={openThisEstimateInAiEstimator}
            className="bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Open AI Estimator
          </Button>

          {HIDDEN_FEATURES.ESTIMATE_DESCRIBE_AND_GENERATE && (
          <Button
            variant="outline"
            onClick={() => { setShowVoiceEstimate(true); setVoiceEstimateItems([]); setVoiceEstimateText(''); }}
            className="bg-gradient-to-r from-green-600 to-teal-600 text-white hover:from-green-700 hover:to-teal-700"
            data-testid="button-voice-to-estimate"
          >
            <Mic className="w-4 h-4 mr-2" />
            Describe &amp; Generate
          </Button>
          )}

          <Button
            variant="outline"
            onClick={() => setShowSupplementConfirm(true)}
            disabled={!estimate}
            className="border-amber-400 text-amber-700 hover:bg-amber-50"
            data-testid="button-revise-supplement"
            title="Edit this estimate, or copy a supplement after it has been sent"
          >
            <Pencil className="w-4 h-4 mr-2" />
            Change estimate
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleGenerateMaterialList}
            disabled={isGeneratingMaterials || !lineItems || lineItems.length === 0}
            className="w-full sm:w-auto md:hidden border-green-600 text-green-700 hover:bg-green-50"
            data-testid="button-material-list-mobile"
          >
            {isGeneratingMaterials ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <ClipboardList className="w-4 h-4 mr-2" />
            )}
            {isGeneratingMaterials ? 'Generating material list…' : 'Generate Material List'}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                {isGeneratingMaterials ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin text-green-600" />
                ) : (
                  <MoreVertical className="w-4 h-4 mr-2" />
                )}
                {isGeneratingMaterials ? 'Generating...' : 'More'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-[calc(100vh-5rem)] overflow-y-auto overscroll-contain"
            >
              <DropdownMenuLabel className="flex items-center gap-1.5 text-purple-700">
                <Sparkles className="w-3.5 h-3.5" />
                Smart Tools
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={handleAiReview}
                disabled={isReviewing || !lineItems?.length}
                data-testid="menu-ai-review"
              >
                {isReviewing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin text-purple-600" />
                    Reviewing…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2 text-purple-600" />
                    AI Review
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleCheckMissing}
                disabled={!lineItems?.length}
                data-testid="menu-check-missing"
              >
                <AlertTriangle className="w-4 h-4 mr-2 text-yellow-600" />
                Check Missing Items
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleDownloadPDF} disabled={isDownloading || !estimate}>
                {isDownloading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600 mr-2"></div>
                    Downloading PDF...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Download PDF
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleGenerateMaterialList} disabled={isGeneratingMaterials || !lineItems || lineItems.length === 0}>
                {isGeneratingMaterials ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-600 mr-2"></div>
                    Generating...
                  </>
                ) : (
                  <>
                    <ClipboardList className="w-4 h-4 mr-2" />
                    Generate Material List
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportToXactimate} disabled={!estimate || !lineItems?.length}>
                <Upload className="w-4 h-4 mr-2" />
                Export to Xactimate (.esx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportXactimateExcel} disabled={!estimate || !lineItems?.length}>
                <Upload className="w-4 h-4 mr-2" />
                Export for Xactimate (Quick Entry .xls)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportToSymbility} disabled={!estimate}>
                <Upload className="w-4 h-4 mr-2" />
                Export to Symbility (.xml)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handlePrintXactimate} disabled={!estimate || !lineItems?.length} data-testid="menu-print-xactimate">
                <FileText className="w-4 h-4 mr-2" />
                Xactimate PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handlePrintSymbility} disabled={!estimate || !lineItems?.length} data-testid="menu-print-symbility">
                <FileText className="w-4 h-4 mr-2" />
                Symbility PDF
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setAllowCustomerEdit(!allowCustomerEdit)}>
                <FileText className="w-4 h-4 mr-2" />
                {allowCustomerEdit ? 'Lock Customer Info' : 'Edit Customer Info'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {estimateVersions.length > 0 && (
                <>
                  <DropdownMenuItem onClick={() => setShowVersionHistory(true)}>
                    <History className="w-4 h-4 mr-2" />
                    Version History
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={handlePreviewEstimate} disabled={isPreviewing || !estimate}>
                {isPreviewing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                    Loading...
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4 mr-2" />
                    Preview PDF
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setShowSupplementConfirm(true)}
                disabled={!estimate}
                data-testid="menu-revise-supplement"
              >
                <Pencil className="w-4 h-4 mr-2 text-amber-600" />
                Change estimate
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => {
                  if (window.confirm('Convert this estimate to an invoice?')) {
                    convertToInvoiceMutation.mutate();
                  }
                }}
                disabled={convertToInvoiceMutation.isPending}
              >
                <FileText className="w-4 h-4 mr-2" />
                Convert to Invoice
              </DropdownMenuItem>
              {abcSupplySetting && formData.status === 'accepted' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={handleOrderFromABC}
                    className="text-orange-600"
                  >
                    <ShoppingCart className="w-4 h-4 mr-2" />
                    Order from ABC Supply
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Send</DropdownMenuLabel>
              <DropdownMenuItem
                data-testid="menu-send-sms"
                onClick={() => sendSmsMutation.mutate()}
                disabled={!estimate || sendSmsMutation.isPending}
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                {sendSmsMutation.isPending ? 'Texting...' : 'Send by Text (SMS)'}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="menu-send-production"
                onClick={() => setShowProductionDialog(true)}
                disabled={!estimate}
              >
                <HardHat className="w-4 h-4 mr-2" />
                Send to Production for Approval
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="menu-send-adjuster"
                onClick={() => {
                  setAdjusterClaimNumber(formData.claim_number || '');
                  setAdjusterName(formData.adjuster_name || '');
                  setShowAdjusterDialog(true);
                }}
                disabled={!estimate}
              >
                <Shield className="w-4 h-4 mr-2" />
                Send to Insurance Adjuster
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={handleDeleteEstimate}
                disabled={deleteMutation.isPending}
                className="text-red-600"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Estimate'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
          <Button
            onClick={handleSendEstimate}
            disabled={sendMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Send className="w-4 h-4 mr-2" />
            {sendMutation.isPending ? 'Sending...' : 'Send to Customer'}
          </Button>
        </div>
      </div>

      {revisionChain.length > 0 && (
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5 rounded-lg text-sm border ${isChangeOrder(estimate) ? 'bg-purple-50 border-purple-200' : 'bg-orange-50 border-orange-200'}`}>
          <span className={`flex items-center gap-1.5 font-medium shrink-0 ${isChangeOrder(estimate) ? 'text-purple-600' : 'text-orange-600'}`}>
            <Copy className="w-3.5 h-3.5" />
            Revision chain:
          </span>
          {revisionChain.map((rev, idx) => {
            const isCurrent = rev.id === estimate?.id;
            const label = rev.estimate_number || rev.estimate_title || `Rev ${idx + 1}`;
            const revIsCo = isChangeOrder(rev);
            return (
              <React.Fragment key={rev.id}>
                {idx > 0 && (
                  <span className={isChangeOrder(estimate) ? 'text-purple-300 select-none' : 'text-orange-300 select-none'}>→</span>
                )}
                {isCurrent ? (
                  <span className={`inline-flex items-center gap-1 font-bold px-1.5 py-0.5 rounded ${revIsCo ? 'text-purple-900 bg-purple-100' : 'text-orange-900 bg-orange-100'}`}>
                    {label}
                    {revIsCo && <ChangeOrderBadge estimate={rev} size="xs" />}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + rev.id)}
                    className={`inline-flex items-center gap-1 font-semibold hover:underline ${revIsCo ? 'text-purple-700 hover:text-purple-900' : 'text-orange-700 hover:text-orange-900'}`}
                  >
                    {label}
                    {revIsCo && <ChangeOrderBadge estimate={rev} size="xs" />}
                  </button>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
      {!revisionChain.length && (estimate?.supplement_of || (estimate?.has_supplement && estimate?.has_supplement_id)) && (
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 rounded-lg text-sm border ${isChangeOrder(estimate) ? 'bg-purple-50 border-purple-200' : 'bg-orange-50 border-orange-200'}`}>
          <span className={`flex items-center gap-1.5 font-medium shrink-0 ${isChangeOrder(estimate) ? 'text-purple-600' : 'text-orange-600'}`}>
            <Copy className="w-3.5 h-3.5" />
            Revision chain:
          </span>
          {estimate.supplement_of && (
            <button
              type="button"
              onClick={() => navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.supplement_of)}
              className={`inline-flex items-center gap-1 font-semibold hover:underline ${isChangeOrder(estimate) ? 'text-purple-700 hover:text-purple-900' : 'text-orange-700 hover:text-orange-900'}`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {estimate.supplement_of_number || 'Original'}
            </button>
          )}
          {estimate.supplement_of && estimate.has_supplement && estimate.has_supplement_id && (
            <span className={isChangeOrder(estimate) ? 'text-purple-300 select-none' : 'text-orange-300 select-none'}>→</span>
          )}
          <span className={`inline-flex items-center gap-1 font-bold px-1.5 py-0.5 rounded ${isChangeOrder(estimate) ? 'text-purple-900 bg-purple-100' : 'text-orange-900 bg-orange-100'}`}>
            {estimate.estimate_number || 'Current'}
            {isChangeOrder(estimate) && <ChangeOrderBadge estimate={estimate} size="xs" />}
          </span>
          {estimate.has_supplement && estimate.has_supplement_id && (
            <>
              <span className="text-orange-300 select-none">→</span>
              <button
                type="button"
                onClick={() => navigate(createPageUrl('EstimateEditor') + '?estimate_id=' + estimate.has_supplement_id)}
                className="inline-flex items-center gap-1 text-orange-700 hover:text-orange-900 font-semibold hover:underline"
              >
                {estimate.has_supplement_number || 'Supplement'}
              </button>
            </>
          )}
        </div>
      )}

      {isChangeOrder(estimate) && (() => {
        const status = changeOrderStatus(estimate);
        const diff = changeOrderComparison?.diff;
        const deltaCents = changeOrderComparison?.deltaCents ?? 0;
        const statusStyles = {
          approved: 'bg-emerald-50 border-emerald-200',
          rejected: 'bg-red-50 border-red-200',
          pending: 'bg-purple-50 border-purple-200',
        };
        return (
          <div
            className={`rounded-lg border p-4 space-y-3 ${statusStyles[status] || statusStyles.pending}`}
            data-testid="panel-change-order"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-purple-700" />
                  <span className="font-semibold text-gray-900">Change order</span>
                  <ChangeOrderBadge estimate={estimate} />
                  {status === 'pending' && (
                    <span className="text-xs font-semibold text-purple-700" data-testid="text-change-order-pending">
                      Pending office approval
                    </span>
                  )}
                  {status === CHANGE_ORDER_APPROVED && (
                    <span className="text-xs font-semibold text-emerald-700" data-testid="text-change-order-approved">
                      Approved{estimate.change_order_approved_by ? ` by ${estimate.change_order_approved_by}` : ''}
                      {estimate.change_order_approved_at ? ` on ${new Date(estimate.change_order_approved_at).toLocaleDateString()}` : ''}
                    </span>
                  )}
                  {status === CHANGE_ORDER_REJECTED && (
                    <span className="text-xs font-semibold text-red-700" data-testid="text-change-order-rejected">
                      Rejected{estimate.change_order_rejected_by ? ` by ${estimate.change_order_rejected_by}` : ''}
                      {estimate.change_order_rejected_at ? ` on ${new Date(estimate.change_order_rejected_at).toLocaleDateString()}` : ''}
                    </span>
                  )}
                </div>
                {estimate.change_order_reason && (
                  <p className="text-sm text-gray-700 mt-1.5" data-testid="text-change-order-reason">
                    <span className="text-gray-500">Reason:</span> {estimate.change_order_reason}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Compared against {estimate.supplement_of_number || 'the original estimate'}. Approved internally — the homeowner doesn't sign this.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!canDecideChangeOrder ? (
                  <span
                    className="text-xs text-gray-500 max-w-[16rem] text-right"
                    data-testid="text-change-order-approval-locked"
                  >
                    {isPermissionsReady
                      ? 'Only an admin or the company owner can approve or reject this.'
                      : 'Checking your permissions…'}
                  </span>
                ) : (
                  <>
                    {status !== CHANGE_ORDER_APPROVED && (
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        disabled={changeOrderDecisionMutation.isPending}
                        onClick={() => changeOrderDecisionMutation.mutate(CHANGE_ORDER_APPROVED)}
                        data-testid="button-approve-change-order"
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1" />
                        Approve
                      </Button>
                    )}
                    {status !== CHANGE_ORDER_REJECTED && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-300 text-red-700 hover:bg-red-50"
                        disabled={changeOrderDecisionMutation.isPending}
                        onClick={() => changeOrderDecisionMutation.mutate(CHANGE_ORDER_REJECTED)}
                        data-testid="button-reject-change-order"
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Reject
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            {!parentEstimate ? (
              <p className="text-sm text-gray-500">Loading the original estimate to compare against…</p>
            ) : (
              <div className="rounded-md border bg-white/70">
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2 text-sm"
                  onClick={() => setShowChangeOrderDetail((v) => !v)}
                  data-testid="button-toggle-change-order-detail"
                >
                  <span className="font-medium text-gray-800">
                    What changed
                    {diff && (
                      <span className="text-gray-500 font-normal">
                        {' '}— {diff.added.length} added, {diff.removed.length} removed, {diff.repriced.length} repriced
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={`font-bold ${deltaCents > 0 ? 'text-emerald-700' : deltaCents < 0 ? 'text-red-700' : 'text-gray-600'}`}
                      data-testid="text-change-order-delta"
                    >
                      {formatCentsSigned(deltaCents)}
                    </span>
                    {showChangeOrderDetail ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </span>
                </button>

                {showChangeOrderDetail && diff && (
                  <div className="border-t px-3 py-2 space-y-2 text-sm">
                    {!diff.hasChanges && (
                      <p className="text-gray-500">No line items differ from {estimate.supplement_of_number || 'the original'} yet.</p>
                    )}
                    {diff.added.map((item, idx) => (
                      <div key={`co-added-${idx}`} className="flex items-start justify-between gap-3">
                        <span className="text-emerald-700 min-w-0">
                          <span className="font-semibold">+ Added</span>{' '}
                          <span className="text-gray-800">{item.description || item.code || 'Line item'}</span>
                        </span>
                        <span className="text-emerald-700 font-medium shrink-0">{formatCentsSigned(lineItemCents(item))}</span>
                      </div>
                    ))}
                    {diff.removed.map((item, idx) => (
                      <div key={`co-removed-${idx}`} className="flex items-start justify-between gap-3">
                        <span className="text-red-700 min-w-0">
                          <span className="font-semibold">− Removed</span>{' '}
                          <span className="text-gray-800">{item.description || item.code || 'Line item'}</span>
                        </span>
                        <span className="text-red-700 font-medium shrink-0">{formatCentsSigned(-lineItemCents(item))}</span>
                      </div>
                    ))}
                    {diff.repriced.map((row, idx) => (
                      <div key={`co-repriced-${idx}`} className="flex items-start justify-between gap-3">
                        <span className="text-amber-700 min-w-0">
                          <span className="font-semibold">~ Repriced</span>{' '}
                          <span className="text-gray-800">{row.item.description || row.item.code || 'Line item'}</span>
                          <span className="text-gray-500">
                            {' '}({formatCents(row.beforeCents)} → {formatCents(row.afterCents)}
                            {row.beforeQuantity !== row.afterQuantity ? `, qty ${row.beforeQuantity} → ${row.afterQuantity}` : ''})
                          </span>
                        </span>
                        <span className="text-amber-700 font-medium shrink-0">{formatCentsSigned(row.deltaCents)}</span>
                      </div>
                    ))}
                    {diff.hasChanges && (
                      <div className="flex items-center justify-between gap-3 border-t pt-2 font-semibold text-gray-900">
                        <span>Net change vs {estimate.supplement_of_number || 'original'}</span>
                        <span>{formatCentsSigned(deltaCents)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-blue-50 border-2 border-blue-200 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">Select Customer/Lead *</Label>
                  <Button
                    size="sm"
                    onClick={() => setShowCreateContactDialog(true)}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Create New
                  </Button>
                </div>
                
                {selectedContactId ? (
                  <div className="flex items-center justify-between bg-white p-3 rounded border-2 border-green-500">
                    <div>
                      <div className="font-medium">{formData.customer_name || <span className="text-gray-400 italic">No name on file</span>}</div>
                      <div className="text-sm text-gray-600">
                        <Badge variant={selectedContactType === 'customer' ? 'default' : 'secondary'} className="mr-2">
                          {selectedContactType}
                        </Badge>
                        {formData.customer_email || formData.customer_phone}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant={allowCustomerEdit ? 'secondary' : 'outline'}
                        onClick={() => setAllowCustomerEdit(!allowCustomerEdit)}
                        data-testid="button-toggle-customer-edit"
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1" />
                        {allowCustomerEdit ? 'Editing' : 'Edit'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelectedContactId(null);
                          setSelectedContactType(null);
                        }}
                      >
                        Change
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      placeholder="Search by name, email, or phone..."
                      className="pr-10"
                    />
                    {contactSearch && (
                      <div className="absolute z-10 w-full mt-1 bg-white border-2 border-blue-300 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                        {filteredContacts.length === 0 ? (
                          <div className="p-4 text-center text-gray-500">
                            <p>No contacts found</p>
                            <Button
                              size="sm"
                              onClick={() => setShowCreateContactDialog(true)}
                              className="mt-2 bg-green-600 hover:bg-green-700"
                            >
                              Create New Contact
                            </Button>
                          </div>
                        ) : (
                          filteredContacts.map((contact) => (
                            <button
                              key={contact.id}
                              onClick={() => handleSelectContact(contact, contact.type)}
                              className="w-full px-4 py-3 text-left hover:bg-blue-50 border-b last:border-b-0 flex items-center gap-3"
                            >
                              <Badge variant={contact.type === 'customer' ? 'default' : 'secondary'}>
                                {contact.type}
                              </Badge>
                              <div className="flex-1">
                                <div className="font-medium">{contact.displayName}</div>
                                <div className="text-xs text-gray-500">
                                  {contact.email || contact.phone}
                                </div>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Customer Name *</Label>
                  <Input
                    value={formData.customer_name}
                    onChange={(e) => setFormData({...formData, customer_name: e.target.value})}
                    placeholder="Customer name"
                    disabled={!allowCustomerEdit && !!selectedContactId}
                  />
                </div>
                <div>
                  <Label>Customer Email</Label>
                  <Input
                    type="email"
                    value={formData.customer_email}
                    onChange={(e) => setFormData({...formData, customer_email: e.target.value})}
                    placeholder="customer@example.com"
                    disabled={!allowCustomerEdit && selectedContactId}
                  />
                </div>
              </div>

              {!selectedContactId && formData.customer_name && (
                <div className="flex gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      createContactMutation.mutate({
                        type: 'customer',
                        name: formData.customer_name,
                        email: formData.customer_email,
                        phone: formData.customer_phone,
                        street: formData.property_address?.split(',')[0]?.trim() || '',
                        city: formData.property_address?.split(',')[1]?.trim() || '',
                        state: formData.property_address?.split(',')[2]?.trim().split(' ')[0]?.trim() || '',
                        zip: formData.property_address?.split(',')[2]?.trim().split(' ')[1]?.trim() || '',
                      });
                    }}
                    disabled={createContactMutation.isPending}
                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    {createContactMutation.isPending ? 'Saving...' : 'Save as Customer'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      createContactMutation.mutate({
                        type: 'lead',
                        name: formData.customer_name,
                        email: formData.customer_email,
                        phone: formData.customer_phone,
                        street: formData.property_address?.split(',')[0]?.trim() || '',
                        city: formData.property_address?.split(',')[1]?.trim() || '',
                        state: formData.property_address?.split(',')[2]?.trim().split(' ')[0]?.trim() || '',
                        zip: formData.property_address?.split(',')[2]?.trim().split(' ')[1]?.trim() || '',
                      });
                    }}
                    disabled={createContactMutation.isPending}
                    className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    {createContactMutation.isPending ? 'Saving...' : 'Save as Lead'}
                  </Button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Customer Phone</Label>
                  <Input
                    value={formData.customer_phone}
                    onChange={(e) => setFormData({...formData, customer_phone: e.target.value})}
                    placeholder="(123) 456-7890"
                    disabled={!allowCustomerEdit && selectedContactId}
                  />
                </div>
                <div>
                  <Label>Property Address</Label>
                  <Input
                    value={formData.property_address}
                    onChange={(e) => setFormData({...formData, property_address: e.target.value})}
                    placeholder="123 Main St"
                    disabled={!allowCustomerEdit && selectedContactId}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Insurance Company</Label>
                  <Input
                    value={formData.insurance_company}
                    onChange={(e) => setFormData({...formData, insurance_company: e.target.value})}
                    placeholder="e.g., State Farm, Geico"
                  />
                </div>
                <div>
                  <Label>Claim Number</Label>
                  <Input
                    value={formData.claim_number}
                    onChange={(e) => setFormData({...formData, claim_number: e.target.value})}
                    placeholder="e.g., CLM-123"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Adjuster Name</Label>
                  <Input
                    value={formData.adjuster_name}
                    onChange={(e) => setFormData({...formData, adjuster_name: e.target.value})}
                    placeholder="e.g., John Doe"
                  />
                </div>
                <div>
                  <Label>Adjuster Phone</Label>
                  <Input
                    value={formData.adjuster_phone}
                    onChange={(e) => setFormData({...formData, adjuster_phone: e.target.value})}
                    placeholder="e.g., (123) 456-7890"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Policy Number</Label>
                  <Input
                    value={formData.policy_number}
                    onChange={(e) => setFormData({...formData, policy_number: e.target.value})}
                    placeholder="e.g., 35GJR1404"
                    data-testid="input-policy-number"
                  />
                </div>
                <div>
                  <Label>Type of Loss</Label>
                  <Input
                    value={formData.type_of_loss}
                    onChange={(e) => setFormData({...formData, type_of_loss: e.target.value})}
                    placeholder="e.g., Wind, Hail"
                    data-testid="input-type-of-loss"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Date of Loss</Label>
                  <Input
                    type="date"
                    value={formData.date_of_loss}
                    onChange={(e) => setFormData({...formData, date_of_loss: e.target.value})}
                    data-testid="input-date-of-loss"
                  />
                </div>
                <div>
                  <Label>Date Inspected</Label>
                  <Input
                    type="date"
                    value={formData.date_inspected}
                    onChange={(e) => setFormData({...formData, date_inspected: e.target.value})}
                    data-testid="input-date-inspected"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Price List</Label>
                  <Input
                    value={formData.price_list}
                    onChange={(e) => setFormData({...formData, price_list: e.target.value})}
                    placeholder="e.g., OHCL28_MAR26"
                    data-testid="input-price-list"
                  />
                </div>
                <div>
                  <Label>Deductible ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.deductible}
                    onChange={(e) => setFormData({...formData, deductible: e.target.value})}
                    placeholder="e.g., 1000.00"
                    data-testid="input-deductible"
                  />
                </div>
              </div>

              <div>
                <Label>Tags</Label>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && tagInput.trim()) {
                          e.preventDefault();
                          if (!formData.tags.includes(tagInput.trim())) {
                            setFormData({...formData, tags: [...formData.tags, tagInput.trim()]});
                          }
                          setTagInput("");
                        }
                      }}
                      placeholder="Type a tag and press Enter"
                    />
                  </div>
                  {formData.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {formData.tags.map((tag, idx) => (
                        <Badge
                          key={idx}
                          variant="secondary"
                          className="cursor-pointer hover:bg-red-100"
                          onClick={() => {
                            setFormData({...formData, tags: formData.tags.filter((_, i) => i !== idx)});
                          }}
                        >
                          {tag} ×
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>Notes</Label>
                  <VoiceNoteButton
                    label="Dictate"
                    cleanupMode={true}
                    storageKey="voiceNote_estimateNotes_cleanupMode"
                    section="estimate notes"
                    onResult={(text) =>
                      setFormData((prev) => ({
                        ...prev,
                        notes: prev.notes ? prev.notes + '\n' + text : text,
                      }))
                    }
                  />
                </div>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  placeholder="Internal notes..."
                  rows={3}
                />
              </div>

              {/* ── Attached Documents ─────────────────────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5" />
                    Attached Support Documents
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => setShowDocPicker(true)}
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    Attach from Library
                  </Button>
                </div>
                {(formData.attached_documents || []).length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No documents attached — click "Attach from Library" to add supplier letters, rebuttal docs, etc.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {(formData.attached_documents || []).map(doc => (
                      <div key={doc.id} className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-md px-3 py-2">
                        <Paperclip className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <a
                          href={doc.file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-blue-700 hover:underline truncate flex-1"
                        >
                          {doc.document_name}
                        </a>
                        {typeof doc.category === 'string' && doc.category && (
                          <span className="text-[10px] text-gray-500 shrink-0 capitalize">{doc.category.replace(/_/g, ' ')}</span>
                        )}
                        <button
                          type="button"
                          className="text-gray-400 hover:text-red-500 shrink-0"
                          onClick={() => setFormData(prev => ({
                            ...prev,
                            attached_documents: (prev.attached_documents || []).filter(d => d.id !== doc.id)
                          }))}
                          title="Remove"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Adjuster Review Results Panel */}
          {adjusterReviews.some(r => r.overall_status === 'submitted') && (
            <Card data-testid="adjuster-review-panel">
              <CardHeader
                className="cursor-pointer select-none"
                onClick={() => setAdjusterPanelCollapsed(v => !v)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-blue-600" />
                    <CardTitle className="text-base">Adjuster Review Results</CardTitle>
                    {(() => {
                      const submitted = adjusterReviews.filter(r => r.overall_status === 'submitted');
                      const totalRejected = submitted.reduce((sum, r) => sum + (r.line_item_reviews || []).filter(li => li.status === 'rejected').length, 0);
                      return totalRejected > 0 ? (
                        <Badge className="bg-red-100 text-red-800 border-red-200" data-testid="badge-rejected-count">
                          {totalRejected} rejected
                        </Badge>
                      ) : (
                        <Badge className="bg-green-100 text-green-800 border-green-200" data-testid="badge-all-approved">
                          All approved
                        </Badge>
                      );
                    })()}
                  </div>
                  {adjusterPanelCollapsed ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronUp className="w-4 h-4 text-gray-400" />}
                </div>
              </CardHeader>

              {!adjusterPanelCollapsed && (
                <CardContent className="space-y-4 pt-0">
                  {adjusterReviews.filter(r => r.overall_status === 'submitted').map((rev) => {
                    const lineItems = rev.line_items || [];
                    const lineReviews = rev.line_item_reviews || [];
                    const approved = lineReviews.filter(r => r.status === 'approved').length;
                    const rejected = lineReviews.filter(r => r.status === 'rejected').length;
                    const pending = lineReviews.filter(r => r.status === 'pending').length;
                    const isExpanded = !expandedReviewIds.has(rev.id);
                    const reviewLink = `${window.location.origin}/adjuster-review?id=${rev.id}`;

                    return (
                      <div
                        key={rev.id}
                        data-testid={`adjuster-review-session-${rev.id}`}
                        className="border rounded-lg overflow-hidden"
                      >
                        {/* Review session header */}
                        <div
                          className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer"
                          onClick={() => setExpandedReviewIds(prev => {
                            const next = new Set(prev);
                            if (next.has(rev.id)) next.delete(rev.id); else next.add(rev.id);
                            return next;
                          })}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="min-w-0">
                              <div className="font-medium text-sm text-gray-900 truncate" data-testid={`text-adjuster-name-${rev.id}`}>
                                {rev.adjuster_name || rev.adjuster_email}
                              </div>
                              {rev.adjuster_name && rev.adjuster_email && (
                                <div className="text-xs text-gray-500 truncate">{rev.adjuster_email}</div>
                              )}
                              {rev.submitted_at && (
                                <div className="text-xs text-gray-400">
                                  Submitted {new Date(rev.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-3">
                            <div className="flex items-center gap-1 text-xs">
                              {approved > 0 && (
                                <span className="flex items-center gap-0.5 text-green-700 font-medium" data-testid={`count-approved-${rev.id}`}>
                                  <CheckCircle2 className="w-3.5 h-3.5" />{approved}
                                </span>
                              )}
                              {rejected > 0 && (
                                <span className="flex items-center gap-0.5 text-red-700 font-medium" data-testid={`count-rejected-${rev.id}`}>
                                  <XCircle className="w-3.5 h-3.5" />{rejected}
                                </span>
                              )}
                              {pending > 0 && (
                                <span className="flex items-center gap-0.5 text-gray-500" data-testid={`count-pending-${rev.id}`}>
                                  <Clock className="w-3.5 h-3.5" />{pending}
                                </span>
                              )}
                            </div>
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                          </div>
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="px-4 py-3 space-y-3">
                            {/* Overall comment */}
                            {rev.overall_comment && (
                              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-900" data-testid={`text-overall-comment-${rev.id}`}>
                                <span className="font-semibold">Adjuster note: </span>{rev.overall_comment}
                              </div>
                            )}

                            {/* Per-line-item rows */}
                            {lineItems.length > 0 && (
                              <div className="space-y-1">
                                {lineItems.map((item, idx) => {
                                  const review = lineReviews[idx] || { status: 'pending', comment: '' };
                                  const isRejected = review.status === 'rejected';
                                  const isApproved = review.status === 'approved';
                                  return (
                                    <div
                                      key={idx}
                                      data-testid={`line-item-review-${rev.id}-${idx}`}
                                      className={`flex items-start gap-3 px-3 py-2 rounded-md text-sm ${
                                        isRejected ? 'bg-red-50 border border-red-200' :
                                        isApproved ? 'bg-green-50 border border-green-100' :
                                        'bg-gray-50 border border-gray-100'
                                      }`}
                                    >
                                      <div className="mt-0.5 shrink-0">
                                        {isRejected ? (
                                          <XCircle className="w-4 h-4 text-red-600" />
                                        ) : isApproved ? (
                                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                                        ) : (
                                          <Clock className="w-4 h-4 text-gray-400" />
                                        )}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className={`font-medium truncate ${isRejected ? 'text-red-900' : isApproved ? 'text-green-900' : 'text-gray-700'}`}>
                                          {item.description || item.name || `Item ${idx + 1}`}
                                        </div>
                                        {review.comment && (
                                          <div className="text-xs text-red-700 mt-0.5" data-testid={`line-item-comment-${rev.id}-${idx}`}>
                                            {review.comment}
                                          </div>
                                        )}
                                      </div>
                                      <div className="shrink-0 text-xs text-gray-500">
                                        {item.quantity && item.unit ? `${item.quantity} ${item.unit}` : ''}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Open Review Link button */}
                            <div className="flex gap-2 pt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                data-testid={`button-copy-review-link-${rev.id}`}
                                onClick={() => {
                                  navigator.clipboard.writeText(reviewLink);
                                }}
                                className="text-xs"
                              >
                                <Copy className="w-3.5 h-3.5 mr-1.5" />
                                Copy Review Link
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                data-testid={`button-open-review-link-${rev.id}`}
                                onClick={() => window.open(reviewLink, '_blank')}
                                className="text-xs"
                              >
                                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                                Open Review
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Estimate Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(estimate?.created_by_name || estimate?.created_by_email) && (
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border text-sm">
                  <span className="text-gray-500 shrink-0">Created by</span>
                  <span className="font-medium text-gray-800 truncate" data-testid="text-estimate-creator">
                    {estimate.created_by_name || estimate.created_by_email}
                  </span>
                </div>
              )}

              <div>
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={(value) => setFormData({...formData, status: value})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="accepted">Accepted</SelectItem>
                    <SelectItem value="declined">Declined</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Category</Label>
                <Select value={formData.category} onValueChange={(value) => setFormData({...formData, category: value})}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="null">None</SelectItem>
                    <SelectItem value="repair">Repair</SelectItem>
                    <SelectItem value="replacement">Replacement</SelectItem>
                    <SelectItem value="new_installation">New Installation</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="inspection">Inspection</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Valid Until</Label>
                <Input
                  type="date"
                  value={formData.valid_until}
                  onChange={(e) => setFormData({...formData, valid_until: e.target.value})}
                />
              </div>

              <div className="flex items-center justify-between py-1">
                <div>
                  <Label className="text-sm font-medium">Professional Proposal Mode</Label>
                  <p className="text-xs text-gray-500">Switches to full proposal format — cover page, aerial photo, Why-Us, categorised scope</p>
                </div>
                <Switch
                  checked={!!formData.show_as_proposal}
                  onCheckedChange={(val) => setFormData(prev => ({
                    ...prev,
                    show_as_proposal: val,
                    format_id: val ? '__professional_proposal__' : '',
                  }))}
                  data-testid="switch-show-as-proposal"
                />
              </div>

              {/* Good / Better / Best shingle options — only shown in proposal mode */}
              {formData.show_as_proposal && (() => {
                const TIERS = [
                  { key: 'good',   label: 'Good',   headerBg: 'bg-emerald-600', textCls: 'text-emerald-700', defaults: { product: '3-Tab Shingle',        warranty: '25-Year',          price: '', features: ['Entry-level pricing', 'Multiple colors available', '60 mph wind resistance'] } },
                  { key: 'better', label: 'Better', headerBg: 'bg-blue-600',    textCls: 'text-blue-700',    defaults: { product: 'Architectural Shingle',   warranty: 'Lifetime',         price: '', features: ['Most popular choice', '130 mph wind resistance', 'Dimensional appearance'] } },
                  { key: 'best',   label: 'Best',   headerBg: 'bg-amber-500',   textCls: 'text-amber-700',   defaults: { product: 'Designer Shingle',        warranty: 'Lifetime Enhanced', price: '', features: ['Premium profile', 'Maximum protection', 'Manufacturer certified install'] } },
                ];
                const opts = formData.material_options?.length === 3 ? formData.material_options : TIERS.map(t => ({ ...t.defaults }));
                const setTierField = (ti, field, val) => {
                  const next = opts.map((o, i) => i === ti ? { ...o, [field]: val } : { ...o });
                  setFormData(prev => ({ ...prev, material_options: next }));
                };
                const setTierFeature = (ti, fi, val) => {
                  const next = opts.map((o, i) => {
                    if (i !== ti) return { ...o };
                    const feats = [...(o.features || ['', '', ''])];
                    feats[fi] = val;
                    return { ...o, features: feats };
                  });
                  setFormData(prev => ({ ...prev, material_options: next }));
                };
                return (
                  <div className="border border-indigo-200 rounded-lg overflow-hidden" data-testid="material-options-panel">
                    <div className="bg-indigo-50 border-b border-indigo-200 px-3 py-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-indigo-900 uppercase tracking-wide">Shingle Options (Good / Better / Best)</span>
                      <span className="text-xs text-indigo-500">Optional — leave blank to hide page</span>
                    </div>
                    {TIERS.map((tier, ti) => {
                      const opt = opts[ti] || tier.defaults;
                      const feats = opt.features || tier.defaults.features;
                      return (
                        <div key={tier.key} className="p-3 border-b last:border-b-0 space-y-1.5">
                          <div className={`inline-block px-2 py-0.5 rounded text-white text-xs font-bold ${tier.headerBg}`}>{tier.label}</div>
                          <input
                            className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300"
                            placeholder={tier.defaults.product}
                            value={opt.product || ''}
                            onChange={e => setTierField(ti, 'product', e.target.value)}
                            data-testid={`input-material-product-${tier.key}`}
                          />
                          <div className="grid grid-cols-2 gap-1">
                            <input
                              className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
                              placeholder={tier.defaults.warranty}
                              value={opt.warranty || ''}
                              onChange={e => setTierField(ti, 'warranty', e.target.value)}
                              data-testid={`input-material-warranty-${tier.key}`}
                            />
                            <input
                              type="number"
                              className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
                              placeholder="Price $"
                              value={opt.price || ''}
                              onChange={e => setTierField(ti, 'price', e.target.value)}
                              data-testid={`input-material-price-${tier.key}`}
                            />
                          </div>
                          {[0, 1, 2].map(fi => (
                            <input
                              key={fi}
                              className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                              placeholder={tier.defaults.features[fi]}
                              value={(feats)[fi] || ''}
                              onChange={e => setTierFeature(ti, fi, e.target.value)}
                              data-testid={`input-material-feature-${tier.key}-${fi}`}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              <div>
                <Label>Format Template</Label>
                <Select 
                  value={formData.format_id || 'none'} 
                  onValueChange={(value) => {
                    const newFormatId = value === 'none' ? '' : value;
                    handleEstimateFormatChange(newFormatId);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Standard Format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Standard Format</SelectItem>
                    <SelectItem value="__professional_proposal__">Professional Proposal</SelectItem>
                    {customFormats.map(format => (
                      <SelectItem key={format.id} value={format.id}>
                        {format.format_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="border-t pt-4">
                <div className="text-center p-4 bg-gradient-to-br from-green-50 to-blue-50 rounded-lg space-y-2">
                  <div className="text-xs text-gray-500">Subtotal: ${subtotal.toFixed(2)}</div>
                  {formData.discount_type !== "none" && discount > 0 && (
                    <div className="text-xs text-red-600">
                      Discount ({formData.discount_type === "percentage" ? `${formData.discount_value}%` : "Fixed"}): -${discount.toFixed(2)}
                    </div>
                  )}
                  {overheadProfit > 0 && (
                    <div className="text-xs text-orange-600">
                      O&amp;P ({(opRate * 100).toFixed(0)}%): +${overheadProfit.toFixed(2)}
                    </div>
                  )}
                  {formData.adjustment_amount !== 0 && (
                    <div className={`text-xs ${formData.adjustment_amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      Adjustment: {formData.adjustment_amount > 0 ? '+' : ''}${Number(formData.adjustment_amount || 0).toFixed(2)}
                    </div>
                  )}
                  <div className="text-sm text-gray-600 mt-2">Total Amount</div>
                  <div className="text-3xl font-bold text-green-600">
                    ${totalRcv.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Financing Toggle */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-green-600" />
                    <span className="text-sm font-medium text-gray-800">Offer Financing</span>
                  </div>
                  <Switch
                    checked={!!formData.financing_enabled}
                    onCheckedChange={(val) => setFormData(prev => ({ ...prev, financing_enabled: val }))}
                    data-testid="switch-estimate-financing"
                    disabled={!myCompany?.settings?.financing?.enabled}
                  />
                </div>
                {!myCompany?.settings?.financing?.enabled ? (
                  <p className="text-xs text-amber-600">Configure financing in Settings → Integrations first.</p>
                ) : formData.financing_enabled && totalRcv > 0 ? (
                  <div className="bg-green-50 rounded-lg p-3 space-y-1">
                    <p className="text-xs font-semibold text-green-800 mb-2">Monthly Payment Preview</p>
                    {(myCompany?.settings?.financing?.terms || [12, 24, 36, 60]).slice(0, 4).map(term => {
                      const annual = 12.99;
                      const r = annual / 12 / 100;
                      const payment = totalRcv * r * Math.pow(1 + r, term) / (Math.pow(1 + r, term) - 1);
                      return (
                        <div key={term} className="flex justify-between text-xs text-green-700">
                          <span>{term} months</span>
                          <span className="font-medium">${payment.toFixed(0)}/mo</span>
                        </div>
                      );
                    })}
                    <p className="text-xs text-gray-400 mt-1">Rates from {myCompany?.settings?.financing?.apr_range || '6.99%–24.99%'}</p>
                  </div>
                ) : formData.financing_enabled ? (
                  <p className="text-xs text-green-700">Financing options will appear on the customer estimate view.</p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle>Line Items</CardTitle>
          </CardHeader>
          <CardContent>
            <LineItemEditor
              items={lineItems}
              onChange={setLineItems}
              format={lineEditorFormat}
              acvAdjustment={estimate?.acv_adjustment_amount}
            />

            <div className="mt-6 pt-4 border-t space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg space-y-4">
                <div className="space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div>
                      <Label htmlFor="estimate-overhead-pct">Overhead (%)</Label>
                      <Input
                        id="estimate-overhead-pct"
                        type="number"
                        min="0"
                        step="0.01"
                        value={overhead_pct}
                        onChange={e => handleOverheadProfitChange(e.target.value, profit_pct)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="estimate-profit-pct">Profit (%)</Label>
                      <Input
                        id="estimate-profit-pct"
                        type="number"
                        min="0"
                        step="0.01"
                        value={profit_pct}
                        onChange={e => handleOverheadProfitChange(overhead_pct, e.target.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleOverheadProfitChange(0, 0)}
                      data-testid="remove-estimate-op"
                    >
                      Remove O&amp;P
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">
                    Applies only to this estimate. Remove O&amp;P sets both rates to 0% and removes separate O&amp;P rows. Click Save Estimate to keep your changes.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>Discount Type</Label>
                    <Select 
                      value={formData.discount_type} 
                      onValueChange={(value) => setFormData({...formData, discount_type: value})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Discount</SelectItem>
                        <SelectItem value="percentage">Percentage (%)</SelectItem>
                        <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {formData.discount_type !== "none" && (
                    <div>
                      <Label>Discount Value</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.discount_value}
                        onChange={(e) => setFormData({...formData, discount_value: parseFloat(e.target.value) || 0})}
                        placeholder={formData.discount_type === "percentage" ? "10" : "100.00"}
                      />
                    </div>
                  )}

                  <div>
                    <Label>Adjustment</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.adjustment_amount}
                      onChange={(e) => setFormData({...formData, adjustment_amount: parseFloat(e.target.value) || 0})}
                      placeholder="0.00"
                    />
                    <p className="text-xs text-gray-500 mt-1">Positive or negative amount</p>
                  </div>
                </div>

                <div className="bg-white p-4 rounded border">
                  {(() => {
                    return (
                      <div className="space-y-2 text-right">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Subtotal:</span>
                          <span className="font-medium">${subtotal.toFixed(2)}</span>
                        </div>
                        {formData.discount_type !== "none" && discount > 0 && (
                          <div className="flex justify-between text-red-600">
                            <span>Discount ({formData.discount_type === "percentage" ? `${formData.discount_value}%` : "Fixed"}):</span>
                            <span>-${discount.toFixed(2)}</span>
                          </div>
                        )}
                        {overheadProfit > 0 && (
                          <div className="flex justify-between text-orange-600">
                            <span>O&amp;P ({(opRate * 100).toFixed(0)}%):</span>
                            <span>+${overheadProfit.toFixed(2)}</span>
                          </div>
                        )}
                        {formData.adjustment_amount !== 0 && (
                          <div className={`flex justify-between ${formData.adjustment_amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            <span>Adjustment:</span>
                            <span>{formData.adjustment_amount > 0 ? '+' : ''}${Number(formData.adjustment_amount || 0).toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-lg font-bold border-t pt-2">
                          <span>Total:</span>
                          <span>${totalRcv.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t flex justify-between">
              <Button
                variant="outline"
                onClick={handlePreviewEstimate}
                disabled={isPreviewing || !estimate}
              >
                {isPreviewing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                    Loading Preview...
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4 mr-2" />
                    Preview Estimate
                  </>
                )}
              </Button>
              <div className="flex gap-2">
                <Button
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="button-save-estimate-bottom"
                >
                  {saveMutation.isPending ? 'Saving...' : 'Save Estimate'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate(createPageUrl('Estimates'))}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showVoiceEstimate} onOpenChange={(open) => { setShowVoiceEstimate(open); if (!open) { setVoiceEstimateItems([]); setVoiceEstimateText(''); setVoiceEstimateRefineText(''); } }}>
        <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col gap-0 p-0">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <Mic className="w-5 h-5 text-green-600" />
              <h2 className="text-lg font-semibold text-gray-900">Describe &amp; Generate</h2>
              {voiceEstimateItems.length > 0 && (
                <span className="ml-auto text-sm font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-0.5">
                  ${voiceEstimateItems.filter(i => i.description.trim()).reduce((s, i) => s + (i.rcv || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">Speak or type what needs to be done — AI generates line items using this estimate's context.</p>
            {(formData.property_address || formData.insurance_company || formData.damage_type) && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {formData.property_address && <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5">{formData.property_address}</span>}
                {formData.insurance_company && <span className="text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded px-2 py-0.5">{formData.insurance_company}</span>}
                {formData.damage_type && <span className="text-xs bg-orange-50 text-orange-700 border border-orange-200 rounded px-2 py-0.5">{formData.damage_type}</span>}
                {lineItems.filter(i => (i.unit||'').toUpperCase()==='SQ' && i.quantity>0).slice(0,1).map(i => (
                  <span key="sq" className="text-xs bg-green-50 text-green-700 border border-green-200 rounded px-2 py-0.5">{i.quantity} SQ roof</span>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Description input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-gray-700">Job Description</label>
                <VoiceNoteButton
                  label="Dictate"
                  cleanupMode={false}
                  storageKey="voiceNote_estimateJobDesc_cleanupMode"
                  section="estimate line items"
                  onResult={(text) => setVoiceEstimateText(prev => prev ? `${prev} ${text}` : text)}
                />
              </div>
              <Textarea
                value={voiceEstimateText}
                onChange={(e) => setVoiceEstimateText(e.target.value)}
                placeholder="e.g. Full roof replacement on a 28 square ranch home. Remove existing 3-tab shingles, install 30-year architectural shingles with ice and water shield on first 3 feet, new ridge cap, replace 2 pipe boots, haul away all debris."
                rows={3}
                data-testid="textarea-voice-estimate"
              />
            </div>

            <Button
              onClick={handleVoiceToEstimate}
              disabled={isGeneratingFromVoice || isRefiningVoice || !voiceEstimateText.trim()}
              className="w-full bg-gradient-to-r from-green-600 to-teal-600 text-white hover:from-green-700 hover:to-teal-700"
              data-testid="button-generate-voice-items"
            >
              {isGeneratingFromVoice ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating line items...</>
              ) : (
                <><Wand2 className="w-4 h-4 mr-2" />{voiceEstimateItems.length > 0 ? 'Regenerate' : 'Generate Line Items'}</>
              )}
            </Button>

            {/* Editable item list */}
            {voiceEstimateItems.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-700 flex-1">{voiceEstimateItems.filter(i=>i.description.trim()).length} items — edit any field, then add to estimate</p>
                </div>

                {/* Column headers */}
                <div className="grid grid-cols-[1fr_56px_52px_80px_72px_24px] gap-1 px-2 text-xs font-medium text-gray-400 uppercase tracking-wide">
                  <span>Description</span><span className="text-center">Qty</span><span className="text-center">Unit</span><span className="text-right">Unit $</span><span className="text-right">Total</span><span />
                </div>

                <div className="border rounded-lg divide-y bg-white max-h-64 overflow-y-auto">
                  {voiceEstimateItems.map((item, idx) => (
                    <div key={item.id} className="grid grid-cols-[1fr_56px_52px_80px_72px_24px] gap-1 items-center px-2 py-1.5 hover:bg-gray-50" data-testid={`row-voice-item-${idx}`}>
                      <input
                        className="text-sm text-gray-900 bg-transparent border-0 outline-none focus:bg-white focus:border focus:border-blue-300 focus:rounded px-1 w-full"
                        value={item.description}
                        onChange={(e) => handleUpdateVoiceItem(idx, 'description', e.target.value)}
                        placeholder="Description"
                      />
                      <input
                        className="text-sm text-center bg-transparent border-0 outline-none focus:bg-white focus:border focus:border-blue-300 focus:rounded px-1 w-full"
                        type="number"
                        min="0"
                        value={item.quantity}
                        onChange={(e) => handleUpdateVoiceItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                      />
                      <input
                        className="text-sm text-center bg-transparent border-0 outline-none focus:bg-white focus:border focus:border-blue-300 focus:rounded px-1 w-full uppercase"
                        value={item.unit}
                        onChange={(e) => handleUpdateVoiceItem(idx, 'unit', e.target.value.toUpperCase())}
                      />
                      <input
                        className="text-sm text-right bg-transparent border-0 outline-none focus:bg-white focus:border focus:border-blue-300 focus:rounded px-1 w-full"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unit_price}
                        onChange={(e) => handleUpdateVoiceItem(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                      />
                      <span className="text-sm font-semibold text-gray-800 text-right pr-1">
                        ${(item.rcv || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <button
                        onClick={() => setVoiceEstimateItems(prev => prev.filter((_, i) => i !== idx))}
                        className="text-gray-300 hover:text-red-500 transition-colors"
                        title="Remove"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleAddCustomVoiceItem}
                  className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium"
                  data-testid="button-add-custom-voice-item"
                >
                  <Plus className="w-4 h-4" /> Add item manually
                </button>

                {/* Refine section */}
                <div className="pt-2 border-t space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">Refine with AI</label>
                    <VoiceNoteButton
                      label="Dictate"
                      cleanupMode={false}
                      storageKey="voiceNote_estimateRefine_cleanupMode"
                      section="estimate refinement"
                      onResult={(text) => setVoiceEstimateRefineText(prev => prev ? `${prev} ${text}` : text)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder="e.g. Add gutters and downspouts, switch to premium materials, remove the overhead line..."
                      value={voiceEstimateRefineText}
                      onChange={(e) => setVoiceEstimateRefineText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && voiceEstimateRefineText.trim()) handleRefineVoiceEstimate(); }}
                      data-testid="input-voice-refine"
                    />
                    <Button
                      onClick={handleRefineVoiceEstimate}
                      disabled={isRefiningVoice || !voiceEstimateRefineText.trim()}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white shrink-0"
                      data-testid="button-refine-voice"
                    >
                      {isRefiningVoice ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-400">AI will update the list above based on your instruction — unchanged items are preserved.</p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 rounded-b-lg flex items-center gap-3 shrink-0">
            <Button variant="outline" onClick={() => setShowVoiceEstimate(false)} className="mr-auto">Cancel</Button>
            {voiceEstimateItems.length > 0 && (
              <Button
                onClick={handleAddVoiceItems}
                className="bg-green-600 hover:bg-green-700 text-white"
                data-testid="button-add-voice-items"
              >
                <Check className="w-4 h-4 mr-2" />
                Add {voiceEstimateItems.filter(i => i.description.trim()).length} Item{voiceEstimateItems.filter(i=>i.description.trim()).length !== 1 ? 's' : ''} to Estimate
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showVersionHistory} onOpenChange={setShowVersionHistory}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              Estimate Version History
            </DialogTitle>
            <DialogDescription>
              View and restore previous versions of this estimate
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {estimateVersions.map((version) => (
              <Card key={version.id} className={version.is_current ? 'border-2 border-blue-500' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">Version {version.version_number}</span>
                        {version.is_current && (
                          <Badge className="bg-green-100 text-green-700">Current</Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">{version.change_description}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        By: {version.changed_by || 'Unknown'} • {new Date(version.created_date).toLocaleString()}
                      </p>
                      <div className="mt-2 text-sm">
                        <p className="text-gray-700">
                          <strong>Customer:</strong> {version.snapshot_data?.customer_name || 'N/A'}
                        </p>
                        <p className="text-gray-700">
                          <strong>Total:</strong> ${Number(version.snapshot_data?.amount || 0).toFixed(2) || '0.00'}
                        </p>
                        <p className="text-gray-700">
                          <strong>Items:</strong> {version.snapshot_data?.items?.length || 0}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setViewingVersion(version)}
                      >
                        <Eye className="w-3 h-3 mr-1" />
                        View
                      </Button>
                      {!version.is_current && (
                        <Button
                          size="sm"
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to restore to Version ${version.version_number}? This will overwrite current data and create a new version reflecting this restoration.`)) {
                              restoreVersionMutation.mutate(version.id);
                            }
                          }}
                          disabled={restoreVersionMutation.isPending}
                        >
                          Restore
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {estimateVersions.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <History className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                <p>No version history yet</p>
                <p className="text-xs mt-1">Versions are created when you save changes</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVersionHistory(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version Preview Dialog */}
      <Dialog open={!!viewingVersion} onOpenChange={() => setViewingVersion(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              Version {viewingVersion?.version_number} Preview
            </DialogTitle>
            <DialogDescription>
              {viewingVersion?.change_description} — saved by {viewingVersion?.changed_by} on {viewingVersion && new Date(viewingVersion.created_date).toLocaleString()}
            </DialogDescription>
          </DialogHeader>
          {viewingVersion && (() => {
            const snap = viewingVersion.snapshot_data || {};
            const items = snap.items || [];
            const total = Number(snap.amount || snap.total_amount || 0);
            return (
              <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                {/* Customer info strip */}
                <div className="grid grid-cols-2 gap-3 text-sm bg-gray-50 rounded-lg p-3">
                  <div><span className="text-gray-500">Customer:</span> <span className="font-medium">{snap.customer_name || '—'}</span></div>
                  <div><span className="text-gray-500">Address:</span> <span className="font-medium">{snap.property_address || '—'}</span></div>
                  <div><span className="text-gray-500">Claim #:</span> <span className="font-medium">{snap.claim_number || '—'}</span></div>
                  <div><span className="text-gray-500">Insurance:</span> <span className="font-medium">{snap.insurance_company || '—'}</span></div>
                </div>

                {/* Line items table */}
                {items.length > 0 ? (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100 text-gray-600">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">#</th>
                          <th className="text-left px-3 py-2 font-medium">Description</th>
                          <th className="text-right px-3 py-2 font-medium">Qty</th>
                          <th className="text-left px-2 py-2 font-medium">Unit</th>
                          <th className="text-right px-3 py-2 font-medium">Rate</th>
                          <th className="text-right px-3 py-2 font-medium">RCV</th>
                          {items.some(i => Number(i.depreciation_percent) > 0) && (
                            <th className="text-right px-3 py-2 font-medium">Dep%</th>
                          )}
                          {items.some(i => Number(i.depreciation_percent) > 0) && (
                            <th className="text-right px-3 py-2 font-medium">ACV</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {items.map((item, idx) => {
                          const hasDepCols = items.some(i => Number(i.depreciation_percent) > 0);
                          return (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                              <td className="px-3 py-2 text-gray-800">{item.description}</td>
                              <td className="px-3 py-2 text-right text-gray-700">
                                {item.import_only && (Number(item.quantity) || 0) === 0
                                  ? <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 whitespace-nowrap" title="Qty not shown in source PDF">—</span>
                                  : Number(item.quantity || 0).toLocaleString()}
                              </td>
                              <td className="px-2 py-2 text-gray-500">{item.unit}</td>
                              <td className="px-3 py-2 text-right text-gray-700">
                                {item.import_only && (Number(item.rate) || 0) === 0
                                  ? <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 whitespace-nowrap" title="Unit price not shown in source PDF">—</span>
                                  : `$${Number(item.rate || 0).toFixed(2)}`}
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-gray-900">${Number(item.rcv || item.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              {hasDepCols && <td className="px-3 py-2 text-right text-orange-600">{Number(item.depreciation_percent || 0).toFixed(0)}%</td>}
                              {hasDepCols && <td className="px-3 py-2 text-right text-gray-700">${Number(item.acv || item.rcv || item.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>}
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                        <tr>
                          <td colSpan={items.some(i => Number(i.depreciation_percent) > 0) ? 7 : 5} className="px-3 py-2 text-right font-semibold text-gray-700">Total</td>
                          <td className="px-3 py-2 text-right font-bold text-gray-900">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <p className="text-center text-gray-400 py-6">No line items in this version</p>
                )}
              </div>
            );
          })()}
          <DialogFooter className="pt-2 border-t">
            <Button variant="outline" onClick={() => setViewingVersion(null)}>Close</Button>
            {viewingVersion && !viewingVersion.is_current && (
              <Button
                onClick={() => {
                  if (window.confirm(`Restore to Version ${viewingVersion.version_number}?`)) {
                    restoreVersionMutation.mutate(viewingVersion.id);
                    setViewingVersion(null);
                  }
                }}
                disabled={restoreVersionMutation.isPending}
              >
                Restore This Version
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateContactDialog} onOpenChange={setShowCreateContactDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Contact</DialogTitle>
            <DialogDescription>
              Add a new customer or lead to your CRM
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            createContactMutation.mutate({
              type: formData.get('type'),
              name: formData.get('name'),
              email: formData.get('email'),
              phone: formData.get('phone'),
              street: formData.get('street'),
              city: formData.get('city'),
              state: formData.get('state'),
              zip: formData.get('zip'),
            });
          }} className="space-y-4">
            <div>
              <Label>Type *</Label>
              <Select name="type" defaultValue="customer" required>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">Customer</SelectItem>
                  <SelectItem value="lead">Lead</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Name *</Label>
              <Input name="name" placeholder="Full name" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Email</Label>
                <Input name="email" type="email" placeholder="email@example.com" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input name="phone" placeholder="(555) 123-4567" />
              </div>
            </div>
            <div>
              <Label>Street Address</Label>
              <Input name="street" placeholder="123 Main St" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>City</Label>
                <Input name="city" placeholder="City" />
              </div>
              <div>
                <Label>State</Label>
                <Input name="state" placeholder="OH" />
              </div>
              <div>
                <Label>ZIP</Label>
                <Input name="zip" placeholder="12345" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateContactDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createContactMutation.isPending}>
                {createContactMutation.isPending ? 'Creating...' : 'Create Contact'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ABC Supply Order Dialog */}
      <Dialog open={showABCOrderDialog} onOpenChange={setShowABCOrderDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-orange-600" />
              Order from ABC Supply
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
              <p className="font-semibold text-orange-900">Estimate: {estimate?.estimate_number}</p>
              <p className="text-sm text-orange-800">Customer: {formData.customer_name}</p>
              <p className="text-sm text-orange-800">Amount: ${totalRcv?.toFixed(2)}</p>
              <p className="text-xs text-orange-700 mt-2">
                {lineItems?.length || 0} line items will be sent to ABC Supply
              </p>
            </div>

            <div>
              <Label>ABC Branch Number *</Label>
              <Input
                placeholder="e.g., 1234"
                value={abcOrderData.branchNumber}
                onChange={(e) => setAbcOrderData({...abcOrderData, branchNumber: e.target.value})}
                required
              />
              <p className="text-xs text-gray-500 mt-1">Contact your ABC rep for your branch number</p>
            </div>

            <div>
              <Label>Delivery Date *</Label>
              <Input
                type="date"
                value={abcOrderData.deliveryDate}
                onChange={(e) => setAbcOrderData({...abcOrderData, deliveryDate: e.target.value})}
                required
              />
            </div>

            <div>
              <Label>Special Instructions</Label>
              <Textarea
                placeholder="Any special delivery or handling instructions..."
                value={abcOrderData.comments}
                onChange={(e) => setAbcOrderData({...abcOrderData, comments: e.target.value})}
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setShowABCOrderDialog(false);
                  setAbcOrderData({ branchNumber: '', deliveryDate: '', comments: '' });
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!abcOrderData.branchNumber) {
                    alert('Please enter your ABC branch number');
                    return;
                  }
                  placeABCOrderMutation.mutate({
                    estimateId: estimate.id,
                    branchNumber: abcOrderData.branchNumber,
                    deliveryDate: abcOrderData.deliveryDate,
                    comments: abcOrderData.comments
                  });
                }}
                disabled={placeABCOrderMutation.isPending}
                className="bg-orange-600 hover:bg-orange-700"
              >
                {placeABCOrderMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Placing Order...
                  </>
                ) : (
                  <>
                    <ShoppingCart className="w-4 h-4 mr-2" />
                    Place Order
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Material List Modal */}
      <Dialog open={showMaterialList} onOpenChange={(open) => { setShowMaterialList(open); if (!open) { setVendorOverrides({}); setExtraMaterialItems([]); setNewExtraItem({ description: '', quantity: 1, unit: 'EA', trade: 'Roofing' }); } }}>
        <DialogContent className="!max-w-[96vw] max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 bg-white">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-green-600" />
                Material Purchase List
              </h2>
              {materialListData?.estimate?.customer_name && (
                <p className="text-sm text-gray-500 mt-0.5">
                  {materialListData.estimate.customer_name} — {materialListData.estimate.property_address}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={downloadMaterialListCSV} size="sm" className="bg-green-600 hover:bg-green-700">
                <Download className="w-4 h-4 mr-1.5" />
                Download CSV
              </Button>
              <Button onClick={() => setShowMaterialList(false)} size="sm" variant="outline">Close</Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b bg-white shrink-0 px-2">
            {[{ key: 'order', label: '📋 Order Sheet' }, { key: 'full', label: '📊 Full Breakdown' }, { key: 'vendor', label: '📝 Vendor List' }].map(tab => (
              <button key={tab.key} onClick={() => setMaterialListTab(tab.key)}
                className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${materialListTab === tab.key ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {tab.label}
              </button>
            ))}
          </div>

          {materialListData && (() => {
            const calcs = materialListData.material_calculations || [];
            const TRADE_ORDER = ['Roofing', 'Gutters & Downspouts', 'Siding & Exterior', 'Windows & Doors', 'Deck', 'Exterior Lighting'];
            const grouped = {};
            (materialListData.materials || []).forEach(item => {
              const g = materialListData.scope === 'siding'
                ? 'Siding & Exterior'
                : getTradeGroup(item);
              if (!grouped[g]) grouped[g] = [];
              grouped[g].push(item);
            });
            extraMaterialItems.forEach(item => {
              const g = item.trade || 'Other';
              if (!grouped[g]) grouped[g] = [];
              grouped[g].push(item);
            });
            const sortedGroups = Object.keys(grouped).sort((a, b) => {
              const ia = TRADE_ORDER.indexOf(a); const ib = TRADE_ORDER.indexOf(b);
              return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
            });

            return (
              <div className="flex-1 overflow-auto flex flex-col">
                <MissingPurchaseMaterials items={materialListData.missing_materials || []} pricingIncomplete={materialListData.pricing_incomplete} />
                {/* ORDER SHEET TAB */}
                {materialListTab === 'order' && (
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead className="sticky top-0 z-10 bg-white border-b shadow-sm">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700">Description</th>
                          <th className="px-3 py-3 text-right font-semibold text-gray-700 w-24">Ins. Qty</th>
                          <th className="px-3 py-3 text-left font-semibold text-gray-700 w-16">Unit</th>
                          <th className="px-3 py-3 text-right font-semibold text-green-800 w-28 bg-green-50">Order Qty</th>
                          <th className="px-3 py-3 text-left font-semibold text-green-800 w-36 bg-green-50">Order Unit</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-400 text-xs">Purchase Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedGroups.map(group => (
                          <>
                            <tr key={`hdr-${group}`} className={`${TRADE_COLORS[group] || 'bg-gray-100 text-gray-900'}`}>
                              <td colSpan={6} className="px-4 py-2 font-bold text-xs uppercase tracking-wide border-t border-b">
                                {group} <span className="font-normal opacity-60 ml-1">({grouped[group].length} item{grouped[group].length !== 1 ? 's' : ''})</span>
                              </td>
                            </tr>
                            {grouped[group].map((item, idx) => {
                              const oq = calcOrderQty(item, calcs);
                              return (
                                <tr key={`${group}-${idx}`} className={`border-b ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'} hover:bg-yellow-50`}>
                                  <td className="px-4 py-2.5 font-medium">{item.description || item.name}</td>
                                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-500">{Number(item.quantity || 0).toFixed(2)}</td>
                                  <td className="px-3 py-2.5 text-gray-400">{item.unit}</td>
                                  <td className="px-3 py-2.5 text-right bg-green-50/70">
                                    {oq ? <span className="font-bold text-green-800 text-base">{oq.qty}</span> : <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="px-3 py-2.5 bg-green-50/70">
                                    {oq && <span className="text-green-700 font-medium text-sm">{oq.unit}</span>}
                                  </td>
                                  <td className="px-4 py-2.5 text-xs text-gray-400 italic">{oq?.note || ''}</td>
                                </tr>
                              );
                            })}
                          </>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* FULL BREAKDOWN TAB */}
                {materialListTab === 'full' && (
                  <div className="flex-1 overflow-auto p-6 space-y-5">
                    {[
                      { key: 'materials', label: '📦 Materials', color: 'bg-green-50', items: materialListData.materials || [] },
                      { key: 'labor', label: '👷 Labor & Services', color: 'bg-blue-50', items: materialListData.labor || [] },
                      { key: 'other', label: '📋 Other', color: 'bg-gray-50', items: materialListData.other || [] },
                    ].filter(s => s.items.length > 0).map(section => (
                      <div key={section.key}>
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                            {section.label}
                            <span className="text-xs font-normal text-gray-400 border rounded px-1.5 py-0.5">{section.items.length}</span>
                          </h3>
                          <span className="text-sm font-semibold text-gray-700">
                            ${Number(materialListData.totals?.[section.key] || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="border rounded-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className={`${section.color} border-b`}>
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold text-gray-700 w-20">Code</th>
                                <th className="px-4 py-2 text-left font-semibold text-gray-700">Description</th>
                                <th className="px-3 py-2 text-right font-semibold text-gray-700 w-20">Qty</th>
                                <th className="px-3 py-2 text-left font-semibold text-gray-700 w-16">Unit</th>
                                <th className="px-3 py-2 text-right font-semibold text-gray-700 w-24">Rate</th>
                                <th className="px-3 py-2 text-right font-semibold text-gray-700 w-28">Amount</th>
                                {section.key === 'materials' && <th className="px-3 py-2 text-center font-semibold text-green-700 w-36 bg-green-50">Order Qty</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {section.items.map((item, idx) => {
                                const oq = section.key === 'materials' ? calcOrderQty(item, calcs) : null;
                                return (
                                  <tr key={idx} className={`border-b ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-yellow-50`}>
                                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{item.code || ''}</td>
                                    <td className="px-4 py-2">
                                      <div className="font-medium">{item.description || item.name}</div>
                                      {item.notes && <div className="text-xs text-gray-400 italic mt-0.5">{item.notes}</div>}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">{Number(item.quantity || 0).toFixed(2)}</td>
                                    <td className="px-3 py-2 text-gray-500">{item.unit}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">${Number(item.rate || item.unitCost || 0).toFixed(2)}</td>
                                    <td className="px-3 py-2 text-right font-semibold tabular-nums">${Number(item.amount || item.totalCost || 0).toFixed(2)}</td>
                                    {section.key === 'materials' && (
                                      <td className="px-3 py-2 text-center bg-green-50/50">
                                        {oq ? (
                                          <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs font-bold px-2 py-1 rounded-full whitespace-nowrap">
                                            {oq.qty} {oq.unit}
                                          </span>
                                        ) : null}
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* VENDOR LIST TAB */}
                {materialListTab === 'vendor' && (
                  <div className="flex-1 overflow-auto p-4 space-y-4">
                    <p className="text-xs text-gray-500 px-1 pb-1">Edit quantities if needed, then copy or download each trade to send to your vendor separately.</p>
                    {sortedGroups.map(group => {
                      const items = grouped[group];
                      const tradeColorClass = TRADE_COLORS[group] || 'bg-gray-100 text-gray-900';
                      const listItems = items.map((item, idx) => {
                        const oq = item._extra ? null : calcOrderQty(item, calcs);
                        const key = item._extra ? `extra-${item._id}` : `${group}-${idx}`;
                        const defaultQty = oq ? String(oq.qty) : (item.quantity ? String(Math.ceil(Number(item.quantity))) : '');
                        const displayQty = vendorOverrides[key] !== undefined ? vendorOverrides[key] : defaultQty;
                        const displayUnit = oq ? oq.unit : (item.unit || '');
                        const desc = item.description || item.name || '';
                        return { key, displayQty, displayUnit, desc, _extra: !!item._extra, _id: item._id };
                      });
                      const copyText = listItems
                        .filter(li => li.displayQty && li.displayQty !== '0')
                        .map(li => `${li.displayQty} ${li.displayUnit} ${li.desc}`.trim())
                        .join(', ');
                      return (
                        <div key={group} className="border rounded-lg overflow-hidden shadow-sm">
                          <div className={`flex items-center justify-between px-4 py-2.5 ${tradeColorClass} border-b`}>
                            <span className="font-bold text-sm uppercase tracking-wide">
                              {group}
                              <span className="font-normal opacity-60 ml-2 normal-case text-xs">({items.length} item{items.length !== 1 ? 's' : ''})</span>
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                data-testid={`button-copy-vendor-${group.replace(/\s+/g, '-')}`}
                                onClick={() => navigator.clipboard.writeText(copyText).then(() => toast.success(`${group} list copied`)).catch(() => toast.error('Copy failed'))}
                                className="flex items-center gap-1 px-3 py-1 rounded bg-white/70 hover:bg-white border text-xs font-semibold text-gray-700 transition-colors"
                              >
                                <Copy className="w-3 h-3" /> Copy List
                              </button>
                              <button
                                data-testid={`button-csv-vendor-${group.replace(/\s+/g, '-')}`}
                                onClick={() => {
                                  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
                                  let csv = `${group} Material Order\r\nCustomer,${esc(materialListData.estimate?.customer_name)}\r\nAddress,${esc(materialListData.estimate?.property_address)}\r\n\r\nQty,Unit,Description\r\n`;
                                  listItems.forEach(li => { csv += [esc(li.displayQty), esc(li.displayUnit), esc(li.desc)].join(',') + '\r\n'; });
                                  const a = document.createElement('a');
                                  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
                                  a.download = `${group.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-order.csv`;
                                  document.body.appendChild(a); a.click(); document.body.removeChild(a);
                                }}
                                className="flex items-center gap-1 px-3 py-1 rounded bg-white/70 hover:bg-white border text-xs font-semibold text-gray-700 transition-colors"
                              >
                                <Download className="w-3 h-3" /> CSV
                              </button>
                            </div>
                          </div>
                          <div className="divide-y bg-white">
                            {listItems.map(({ key, displayQty, displayUnit, desc, _extra, _id }) => (
                              <div key={key} className={`flex items-center gap-3 px-4 py-2 hover:bg-yellow-50 transition-colors ${_extra ? 'bg-blue-50/30' : ''}`}>
                                <input
                                  type="number"
                                  min="0"
                                  value={displayQty}
                                  onChange={e => setVendorOverrides(prev => ({ ...prev, [key]: e.target.value }))}
                                  className="w-16 text-right font-bold text-green-800 bg-green-50 border border-green-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-green-400"
                                  data-testid={`input-vendor-qty-${key}`}
                                />
                                <span className="text-green-700 font-medium text-sm w-28 shrink-0">{displayUnit}</span>
                                <span className="text-sm text-gray-800">{desc}</span>
                                {_extra && (
                                  <button onClick={() => setExtraMaterialItems(prev => prev.filter(i => i._id !== _id))} className="ml-auto text-red-300 hover:text-red-600 transition-colors" title="Remove item">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="px-4 py-2 bg-gray-50 border-t">
                            <p className="text-xs text-gray-400 italic">{copyText || 'No items with order quantities'}</p>
                          </div>
                        </div>
                      );
                    })}

                    {/* Add Item form */}
                    <div className="border-2 border-dashed border-green-200 rounded-lg bg-green-50/40 p-4">
                      <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-3">➕ Add Miscellaneous Item</p>
                      <div className="flex flex-wrap gap-2 items-end">
                        <div className="flex-1 min-w-[160px]">
                          <label className="block text-xs text-gray-500 mb-1">Description</label>
                          <input
                            type="text"
                            placeholder="e.g. Roofing Nails, Caulk…"
                            value={newExtraItem.description}
                            onChange={e => setNewExtraItem(prev => ({ ...prev, description: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && newExtraItem.description.trim()) {
                                setExtraMaterialItems(prev => [...prev, { ...newExtraItem, _extra: true, _id: Date.now() + Math.random() }]);
                                setNewExtraItem({ description: '', quantity: 1, unit: 'EA', trade: newExtraItem.trade });
                              }
                            }}
                            className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-400 bg-white"
                            data-testid="input-extra-item-description"
                          />
                        </div>
                        <div className="w-20">
                          <label className="block text-xs text-gray-500 mb-1">Qty</label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={newExtraItem.quantity}
                            onChange={e => setNewExtraItem(prev => ({ ...prev, quantity: e.target.value }))}
                            className="w-full border rounded px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-green-400 bg-white"
                            data-testid="input-extra-item-qty"
                          />
                        </div>
                        <div className="w-28">
                          <label className="block text-xs text-gray-500 mb-1">Unit</label>
                          <select
                            value={newExtraItem.unit}
                            onChange={e => setNewExtraItem(prev => ({ ...prev, unit: e.target.value }))}
                            className="w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-400 bg-white"
                            data-testid="select-extra-item-unit"
                          >
                            {['EA','box','roll','bundle','bag','tube','lb','sheet','stick','section','gallon','pail'].map(u => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </div>
                        <div className="w-44">
                          <label className="block text-xs text-gray-500 mb-1">Category</label>
                          <select
                            value={newExtraItem.trade}
                            onChange={e => setNewExtraItem(prev => ({ ...prev, trade: e.target.value }))}
                            className="w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-400 bg-white"
                            data-testid="select-extra-item-trade"
                          >
                            {['Roofing','Gutters & Downspouts','Siding & Exterior','Windows & Doors','Deck','Exterior Lighting','Other'].map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        <button
                          onClick={() => {
                            if (!newExtraItem.description.trim()) return;
                            setExtraMaterialItems(prev => [...prev, { ...newExtraItem, _extra: true, _id: Date.now() + Math.random() }]);
                            setNewExtraItem({ description: '', quantity: 1, unit: 'EA', trade: newExtraItem.trade });
                          }}
                          disabled={!newExtraItem.description.trim()}
                          className="px-4 py-1.5 rounded bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-sm font-semibold transition-colors"
                          data-testid="button-add-extra-item"
                        >
                          Add
                        </button>
                      </div>
                      {extraMaterialItems.length > 0 && (
                        <p className="text-xs text-green-600 mt-2">{extraMaterialItems.length} custom item{extraMaterialItems.length !== 1 ? 's' : ''} added — they appear above in their category and are included in CSV export.</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Footer totals */}
                <div className="shrink-0 border-t bg-gray-900 text-white flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-8 text-sm">
                    <span><span className="text-gray-400">Materials</span><span className="font-semibold ml-2">${Number(materialListData.totals?.materials || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
                    <span><span className="text-gray-400">Labor</span><span className="font-semibold ml-2">${Number(materialListData.totals?.labor || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
                    {(materialListData.totals?.other || 0) > 0 && <span><span className="text-gray-400">Other</span><span className="font-semibold ml-2">${Number(materialListData.totals?.other || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>}
                  </div>
                  <div className="text-lg font-bold">Grand Total: <span className="text-green-400">${Number(materialListData.totals?.grand_total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Send to Production for Approval */}
      <Dialog open={showProductionDialog} onOpenChange={(open) => { setShowProductionDialog(open); if (!open) { setProductionEmail(''); setProductionNote(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HardHat className="w-5 h-5 text-orange-600" />
              Send to Production for Approval
            </DialogTitle>
            <DialogDescription>
              Email this estimate to your production team for review and approval before work begins.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="prod-email">Production Team Email <span className="text-red-500">*</span></Label>
              <Input
                id="prod-email"
                data-testid="input-production-email"
                type="text"
                list="estimate-production-staff"
                placeholder="Type a staff name or email"
                value={productionEmail}
                onChange={e => selectProductionRecipient(e.target.value)}
              />
              <datalist id="estimate-production-staff">
                {productionStaff.map((staff) => (
                  <option key={getStaffEmail(staff)} value={getStaffDisplayName(staff)}>
                    {getStaffEmail(staff)}
                  </option>
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Start typing a staff name to fill in their email, or enter an email directly.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="prod-note">Note to Team (optional)</Label>
              <Textarea
                id="prod-note"
                data-testid="input-production-note"
                placeholder="Any special instructions or context for the production crew..."
                rows={3}
                value={productionNote}
                onChange={e => setProductionNote(e.target.value)}
              />
            </div>
            {estimate && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800">
                <strong>Estimate:</strong> {estimate.estimate_number || estimate.estimate_title} — {formData.customer_name || 'Customer'}, {lineItems.length} line item{lineItems.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowProductionDialog(false)}>Cancel</Button>
            <Button
              data-testid="button-send-production"
              disabled={!isValidRecipientEmail(productionEmail) || isSendingProduction}
              className="bg-orange-600 hover:bg-orange-700 text-white"
              onClick={async () => {
                if (!productionEmail.trim()) return;
                setIsSendingProduction(true);
                try {
                  const totalRcv = lineItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
                  const totalAcv = sumNetAcv(lineItems, estimate?.acv_adjustment_amount);
                  await base44.functions.invoke('sendEstimateEmail', {
                    to: productionEmail.trim(),
                    customerName: formData.customer_name || 'Customer',
                    estimateData: {
                      estimate_number: estimate?.estimate_number || '',
                      estimate_title: estimate?.estimate_title || estimate?.title || 'Estimate',
                      line_items: lineItems,
                      total_rcv: totalRcv,
                      total_acv: totalAcv,
                    },
                    emailType: 'production_approval',
                    note: productionNote.trim(),
                  });
                  setShowProductionDialog(false);
                  setProductionEmail('');
                  setProductionNote('');
                  alert(`✅ Estimate sent to production team at ${productionEmail} for approval.`);
                } catch (err) {
                  alert('Failed to send: ' + err.message);
                } finally {
                  setIsSendingProduction(false);
                }
              }}
            >
              {isSendingProduction ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending…</> : <><HardHat className="w-4 h-4 mr-2" />Send for Approval</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send to Insurance Adjuster */}
      <Dialog open={showAdjusterDialog} onOpenChange={(open) => { setShowAdjusterDialog(open); if (!open) { setAdjusterName(''); setAdjusterEmail(''); setAdjusterClaimNumber(''); setAdjusterNote(''); setAdjusterIncludeReview(true); setAdjusterAttachClaimsDefense(false); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              Send to Insurance Adjuster
            </DialogTitle>
            <DialogDescription>
              Send this estimate directly to the insurance adjuster handling the claim.
            </DialogDescription>
          </DialogHeader>

          {/* Past reviews summary */}
          {adjusterReviews.length > 0 && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Previous Review Sessions</p>
              {adjusterReviews.slice(0, 3).map((rev) => {
                const reviews = rev.line_item_reviews || [];
                const approved = reviews.filter(r => r.status === 'approved').length;
                const rejected = reviews.filter(r => r.status === 'rejected').length;
                const pending = reviews.filter(r => r.status === 'pending').length;
                return (
                  <div key={rev.id} data-testid={`row-past-review-${rev.id}`} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-700">{rev.adjuster_email || rev.adjuster_name}</span>
                      <Badge className={rev.overall_status === 'submitted' ? 'bg-green-100 text-green-800 border-green-200' : 'bg-yellow-100 text-yellow-800 border-yellow-200'}>
                        {rev.overall_status === 'submitted' ? 'Submitted' : 'Pending'}
                      </Badge>
                    </div>
                    {rev.overall_status === 'submitted' && (
                      <span className="text-gray-600">
                        <span className="text-green-700 font-semibold">{approved}✓</span>
                        {rejected > 0 && <span className="text-red-700 font-semibold ml-1">{rejected}✗</span>}
                        {pending > 0 && <span className="text-gray-500 ml-1">{pending}?</span>}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="adj-name">Adjuster Name <span className="text-red-500">*</span></Label>
                <Input
                  id="adj-name"
                  data-testid="input-adjuster-name"
                  placeholder="Jane Smith"
                  value={adjusterName}
                  onChange={e => setAdjusterName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="adj-claim">Claim Number</Label>
                <Input
                  id="adj-claim"
                  data-testid="input-adjuster-claim"
                  placeholder="CLM-2026-00001"
                  value={adjusterClaimNumber}
                  onChange={e => setAdjusterClaimNumber(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="adj-email">Adjuster Email <span className="text-red-500">*</span></Label>
              <Input
                id="adj-email"
                data-testid="input-adjuster-email"
                type="email"
                placeholder="adjuster@insuranceco.com"
                value={adjusterEmail}
                onChange={e => setAdjusterEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="adj-note">Note (optional)</Label>
              <Textarea
                id="adj-note"
                data-testid="input-adjuster-note"
                placeholder="Additional context for the adjuster..."
                rows={3}
                value={adjusterNote}
                onChange={e => setAdjusterNote(e.target.value)}
              />
            </div>
            {/* Attached support documents */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-sm">
                  <Paperclip className="w-3.5 h-3.5" />
                  Support Documents
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs h-7"
                  onClick={() => setShowDocPicker(true)}
                >
                  <Paperclip className="w-3 h-3" />
                  Attach from Library
                </Button>
              </div>
              {(formData.attached_documents || []).length === 0 ? (
                <p className="text-xs text-gray-400 italic">No documents attached — supplier letters and rebuttal docs will be included as links in the email.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {(formData.attached_documents || []).map(doc => (
                    <div key={doc.id} className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded px-2.5 py-1.5">
                      <Paperclip className="w-3 h-3 text-blue-500 shrink-0" />
                      <span className="text-xs font-medium text-blue-700 truncate flex-1">{doc.document_name}</span>
                      <button
                        type="button"
                        className="text-gray-400 hover:text-red-500 shrink-0"
                        onClick={() => setFormData(prev => ({
                          ...prev,
                          attached_documents: (prev.attached_documents || []).filter(d => d.id !== doc.id)
                        }))}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
              <Switch
                id="adj-include-review"
                data-testid="switch-include-review"
                checked={adjusterIncludeReview}
                onCheckedChange={setAdjusterIncludeReview}
              />
              <div>
                <Label htmlFor="adj-include-review" className="text-sm font-semibold text-blue-900 cursor-pointer">
                  Include interactive line-item review link
                </Label>
                <p className="text-xs text-blue-700 mt-0.5">
                  Adjuster can approve or reject each line item directly in their browser — no login required.
                </p>
              </div>
            </div>

            {(estimate?.related_inspection_job_id || estimate?.inspection_job_id) && (
              <div className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5">
                <Switch
                  id="adj-attach-claims-defense"
                  data-testid="switch-attach-claims-defense"
                  checked={adjusterAttachClaimsDefense}
                  onCheckedChange={setAdjusterAttachClaimsDefense}
                />
                <div>
                  <Label htmlFor="adj-attach-claims-defense" className="text-sm font-semibold text-indigo-900 cursor-pointer">
                    Attach Claims Defense File PDF
                  </Label>
                  <p className="text-xs text-indigo-800 mt-0.5 font-medium">
                    Linked inspection job: {estimate?.related_inspection_job_id || estimate?.inspection_job_id}
                  </p>
                  <p className="text-xs text-indigo-700 mt-0.5">
                    Generate and attach the inspection proof package directly to this email (up to 8 MB).
                  </p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdjusterDialog(false)}>Cancel</Button>
            <Button
              data-testid="button-send-adjuster"
              disabled={!adjusterName.trim() || !adjusterEmail.trim() || isSendingAdjuster}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={async () => {
                if (!adjusterName.trim() || !adjusterEmail.trim()) return;
                setIsSendingAdjuster(true);
                try {
                  const totalRcv = lineItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
                        const totalAcv = sumNetAcv(lineItems, estimate?.acv_adjustment_amount);
                  let reviewLink = '';
                  if (adjusterIncludeReview && estimateId && lineItems.length > 0) {
                    try {
                      const reviewEntity = await base44.entities.EstimateLineReview.create({
                        estimate_id: estimateId,
                        company_id: myCompany?.id,
                        adjuster_name: adjusterName.trim(),
                        adjuster_email: adjusterEmail.trim(),
                        claim_number: adjusterClaimNumber.trim(),
                        estimate_number: estimate?.estimate_number || '',
                        estimate_title: estimate?.estimate_title || estimate?.title || 'Estimate',
                        company_name: myCompany?.company_name || myCompany?.name || '',
                        line_items: lineItems,
                        total_rcv: totalRcv,
                        total_acv: totalAcv,
                        line_item_reviews: [],
                        overall_status: 'pending',
                        created_at: new Date().toISOString(),
                      });
                      if (reviewEntity?.id) {
                        const appUrl = window.location.origin;
                        reviewLink = `${appUrl}/adjuster-review?id=${reviewEntity.id}`;
                        refetchAdjusterReviews();
                      }
                    } catch (reviewErr) {
                      console.warn('[AdjusterDialog] Review creation failed:', reviewErr.message);
                    }
                  }
                  const attachedDocs = formData.attached_documents || [];
                  const docsNoteBlock = attachedDocs.length > 0
                    ? '\n\nSupporting Documents:\n' + attachedDocs.map(d => `• ${d.document_name}: ${d.file_url}`).join('\n')
                    : '';
                  const noteWithDocs = adjusterNote.trim() + docsNoteBlock;

                  const sendRes = await base44.functions.invoke('sendEstimateEmail', {
                    to: adjusterEmail.trim(),
                    customerName: formData.customer_name || 'Customer',
                    estimateData: {
                      estimate_number: estimate?.estimate_number || '',
                      estimate_title: estimate?.estimate_title || estimate?.title || 'Estimate',
                      line_items: lineItems,
                      total_rcv: totalRcv,
                      total_acv: totalAcv,
                      claim_number: adjusterClaimNumber.trim(),
                    },
                    emailType: 'adjuster',
                    adjusterName: adjusterName.trim(),
                    claimNumber: adjusterClaimNumber.trim(),
                    note: noteWithDocs,
                    reviewLink,
                    companyId: myCompany?.id,
                    attach_claims_defense: adjusterAttachClaimsDefense,
                    inspection_job_id: estimate?.related_inspection_job_id || estimate?.inspection_job_id || null,
                  });
                  setShowAdjusterDialog(false);
                  setAdjusterName('');
                  setAdjusterEmail('');
                  setAdjusterClaimNumber('');
                  setAdjusterNote('');
                  setAdjusterIncludeReview(true);
                  setAdjusterAttachClaimsDefense(false);
                  const successMsg = `✅ Estimate sent to adjuster ${adjusterName} at ${adjusterEmail}.${reviewLink ? ' A line-item review link was included.' : ''}`;
                  const attachmentWarning = sendRes?.data?.warning
                    || sendRes?.warning
                    || sendRes?.data?.claims_attach_warning
                    || sendRes?.claims_attach_warning;
                  const warningMsg = attachmentWarning
                    ? `\n\n⚠️ ${attachmentWarning}` : '';
                  alert(successMsg + warningMsg);
                } catch (err) {
                  alert('Failed to send: ' + err.message);
                } finally {
                  setIsSendingAdjuster(false);
                }
              }}
            >
              {isSendingAdjuster ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending…</> : <><Shield className="w-4 h-4 mr-2" />Send to Adjuster</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Review Dialog */}
      <Dialog open={showAiReviewDialog} onOpenChange={setShowAiReviewDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              AI Estimate Review
            </DialogTitle>
            {aiReviewData?.analysis_summary && (
              <DialogDescription>{aiReviewData.analysis_summary}</DialogDescription>
            )}
          </DialogHeader>
          {aiReviewData && (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-gray-50 rounded-lg p-4 border">
                <span className="font-semibold text-gray-900">Estimate Quality Score</span>
                <Badge className={`text-base px-4 py-1 ${
                  aiReviewData.estimate_quality_score >= 85 ? 'bg-green-600' :
                  aiReviewData.estimate_quality_score >= 70 ? 'bg-orange-500' : 'bg-red-600'
                }`}>
                  {aiReviewData.estimate_quality_score}/100
                </Badge>
              </div>

              {['critical','recommended','optional'].map(priority => {
                const items = (aiReviewData.suggestions || []).filter(s => s.priority === priority);
                if (!items.length) return null;
                const cfg = {
                  critical:    { label: '🔴 Critical Items (Usually Required)',           bg: 'bg-red-50 border-red-200',    btn: 'bg-red-600 hover:bg-red-700' },
                  recommended: { label: '🟡 Recommended Items (Common for This Job Type)', bg: 'bg-yellow-50 border-yellow-200', btn: 'bg-yellow-600 hover:bg-yellow-700' },
                  optional:    { label: '🔵 Optional Items (Upgrades / Add-ons)',          bg: 'bg-blue-50 border-blue-200',   btn: 'bg-blue-600 hover:bg-blue-700' },
                }[priority];
                return (
                  <div key={priority}>
                    <h3 className="font-semibold text-gray-900 mb-3">{cfg.label}</h3>
                    <div className="space-y-3">
                      {items.map((item, idx) => (
                        <div key={idx} className={`border rounded-lg p-4 ${cfg.bg}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <p className="font-semibold text-gray-900 mb-1">{item.item_description}</p>
                              <p className="text-sm text-gray-700">{item.reason}</p>
                              {item.calculation_note && (
                                <p className="text-xs text-gray-600 italic mt-1">💡 {item.calculation_note}</p>
                              )}
                              {item.typical_quantity && item.typical_unit && (
                                <p className="text-sm font-medium text-gray-800 mt-2 bg-white/60 rounded px-2 py-1 inline-block">
                                  Suggested: {item.typical_quantity} {item.typical_unit}
                                </p>
                              )}
                            </div>
                            <Button size="sm" onClick={() => handleAddReviewItem(item)}
                              className={`text-white shrink-0 ${cfg.btn}`}>
                              Add
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {!(aiReviewData.suggestions?.length) && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                  <p className="text-lg font-semibold text-green-900">✅ Estimate Looks Complete!</p>
                  <p className="text-sm text-green-700 mt-1">No missing items detected based on industry standards.</p>
                </div>
              )}

              <div className="flex justify-end pt-2 border-t">
                <Button variant="outline" onClick={() => setShowAiReviewDialog(false)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ReviseEstimateDialog
        open={showSupplementConfirm}
        onOpenChange={setShowSupplementConfirm}
        estimate={{
          estimate_number: estimate?.estimate_number,
          customer_name: formData.customer_name,
          status: formData.status || estimate?.status || 'draft',
        }}
        onEditHere={() => setShowSupplementConfirm(false)}
        onOpenAiEstimator={() => {
          setShowSupplementConfirm(false);
          openThisEstimateInAiEstimator();
        }}
        onCreateCopy={({ asChangeOrder, reason }) => {
          setShowSupplementConfirm(false);
          handleCreateSupplement({ asChangeOrder, reason });
        }}
      />

      {/* Document Picker */}
      <DocumentPickerDialog
        isOpen={showDocPicker}
        onOpenChange={setShowDocPicker}
        companyId={myCompany?.id}
        alreadyAttached={formData.attached_documents || []}
        onSelect={(newDocs) => {
          setFormData(prev => {
            const existing = prev.attached_documents || [];
            const existingIds = new Set(existing.map(d => d.id));
            const toAdd = newDocs
              .filter(d => !existingIds.has(d.id))
              .map(d => ({ id: d.id, document_name: d.document_name, file_url: d.file_url, category: d.category || '' }));
            return { ...prev, attached_documents: [...existing, ...toAdd] };
          });
        }}
      />

      <Dialog open={showMissingDialog} onOpenChange={setShowMissingDialog}>
        <DialogContent className="max-w-lg max-h-[75vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              Check Missing Items
            </DialogTitle>
            <DialogDescription>
              {missingScope === 'siding'
                ? 'Common siding and exterior items not found in this estimate'
                : missingScope === 'roofing'
                  ? 'Common roofing items not found in this estimate'
                  : 'Select a trade-specific estimate scope to check missing items'}
            </DialogDescription>
          </DialogHeader>
          {missingItems.length === 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
              <p className="text-lg font-semibold text-green-900">✅ Looks Good!</p>
              <p className="text-sm text-green-700 mt-1">
                {missingScope === 'siding'
                  ? 'No commonly missing siding items detected.'
                  : missingScope === 'roofing'
                    ? 'No commonly missing roofing items detected.'
                    : 'No trade-specific missing items detected.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
               {missingItems.map((item, idx) => (
                 <div key={idx} className="flex items-center justify-between gap-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3" data-testid={`missing-item-${missingScope}-${idx}`}>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{item.label}</p>
                    <p className="text-xs text-gray-600">{item.reason}</p>
                  </div>
                  <Button size="sm" variant="outline"
                    className="border-yellow-500 text-yellow-700 hover:bg-yellow-100 shrink-0"
                    onClick={() => handleAddMissingItem(item)}>
                    Add
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end pt-2 border-t mt-2">
            <Button variant="outline" onClick={() => setShowMissingDialog(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}