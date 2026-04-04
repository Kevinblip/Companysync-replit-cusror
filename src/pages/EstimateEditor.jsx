import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { generateMaterialList } from "@/lib/functions";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
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
  Shield,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Mail,
  Phone,
  Camera,
  MapPin,
  Link2,
  X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import LineItemEditor from "../components/estimates/LineItemEditor";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function EstimateEditor() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const urlParams = new URLSearchParams(location.search);
  const estimateId = urlParams.get('estimate_id');

  const [user, setUser] = useState(null);
  const [lineItems, setLineItems] = useState([]);
  const [isExporting, setIsExporting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState(null);
  const [selectedContactType, setSelectedContactType] = useState(null); // 'customer' or 'lead'
  const [showCreateContactDialog, setShowCreateContactDialog] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [allowCustomerEdit, setAllowCustomerEdit] = useState(false);
  const [showABCOrderDialog, setShowABCOrderDialog] = useState(false);
  const [showMaterialList, setShowMaterialList] = useState(false);
  const [materialListData, setMaterialListData] = useState(null);
  const [isGeneratingMaterials, setIsGeneratingMaterials] = useState(false);
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
          notes: "",
          status: "draft",
          valid_until: "",
          format_id: "",
          category: "",
          tags: [],
          discount_type: "none",
          discount_value: 0,
          adjustment_amount: 0,
          financing_enabled: false,
        });
  const [tagInput, setTagInput] = useState("");
  const [loadedEstimateId, setLoadedEstimateId] = useState(null);

  // N.E.W.S. elevation photos state
  const [newsExpanded, setNewsExpanded] = useState(false);
  const [uploadingSection, setUploadingSection] = useState(null);
  const [selectedNewsPhoto, setSelectedNewsPhoto] = useState(null);

  // Satellite view state
  const [satelliteExpanded, setSatelliteExpanded] = useState(false);
  const [mapsApiKey, setMapsApiKey] = useState('');

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  useEffect(() => {
    base44.functions.invoke('getGoogleMapsApiKey')
      .then(r => { if (r?.data?.apiKey) setMapsApiKey(r.data.apiKey); })
      .catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

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
    initialData: []
  });

  const { data: customFormats = [] } = useQuery({
    queryKey: ['custom-formats', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.EstimateFormat.filter({ is_active: true, company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, '-created_date', 1000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, '-created_date', 1000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: integrationSettings = [] } = useQuery({
    queryKey: ['integration-settings'],
    queryFn: () => myCompany ? base44.entities.IntegrationSetting.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
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
    enabled: !!estimate?.customer_id
  });

  // NEW: Fetch specific linked lead
  const { data: linkedLead } = useQuery({
    queryKey: ['linked-lead', estimate?.lead_id],
    queryFn: async () => {
      if (!estimate?.lead_id) return null;
      const res = await base44.entities.Lead.filter({ id: estimate.lead_id });
      return res[0];
    },
    enabled: !!estimate?.lead_id
  });

  // N.E.W.S. - Find linked InspectionJob (explicit link or by customer match)
  const { data: linkedInspectionJob } = useQuery({
    queryKey: ['linked-inspection-job', estimate?.related_inspection_job_id, estimate?.customer_id],
    queryFn: async () => {
      if (estimate?.related_inspection_job_id) {
        const jobs = await base44.entities.InspectionJob.filter({ id: estimate.related_inspection_job_id });
        return jobs[0] || null;
      }
      if (estimate?.customer_id) {
        const jobs = await base44.entities.InspectionJob.filter({ customer_id: estimate.customer_id }, '-created_date', 1);
        return jobs[0] || null;
      }
      return null;
    },
    enabled: !!estimate,
  });

  // N.E.W.S. - Get elevation photos (from linked InspectionJob OR directly from estimate)
  const { data: newsPhotos = [], refetch: refetchNewsPhotos } = useQuery({
    queryKey: ['news-photos', linkedInspectionJob?.id, estimateId],
    queryFn: async () => {
      const results = [];
      if (linkedInspectionJob?.id) {
        const jobPhotos = await base44.entities.JobMedia.filter({
          related_entity_id: linkedInspectionJob.id,
          related_entity_type: 'InspectionJob',
          file_type: 'photo',
        });
        results.push(...jobPhotos);
      }
      if (estimateId) {
        const estPhotos = await base44.entities.JobMedia.filter({
          related_entity_id: estimateId,
          related_entity_type: 'Estimate',
          file_type: 'photo',
        });
        estPhotos.forEach(p => { if (!results.find(r => r.id === p.id)) results.push(p); });
      }
      return results;
    },
    enabled: !!(linkedInspectionJob?.id || estimateId),
    initialData: [],
  });

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
        const newEmail = prev.customer_email || contact.email || "";
        const newPhone = prev.customer_phone || contact.phone || "";
        
        // Address parsing
        let address = prev.property_address;
        if (!address && (contact.street || contact.address)) {
           const street = contact.street || contact.address || "";
           const city = contact.city || "";
           const state = contact.state || "";
           const zip = contact.zip || "";
           address = street ? `${street}, ${city}, ${state} ${zip}`.trim() : "";
        }

        const newIns = prev.insurance_company || contact.insurance_company || "";
        const newClaim = prev.claim_number || contact.claim_number || "";
        const newAdjName = prev.adjuster_name || contact.adjuster_name || "";
        const newAdjPhone = prev.adjuster_phone || contact.adjuster_phone || "";

        // Only trigger update if something changed
        if (
          newEmail !== prev.customer_email ||
          newPhone !== prev.customer_phone ||
          address !== prev.property_address ||
          newIns !== prev.insurance_company ||
          newClaim !== prev.claim_number ||
          newAdjName !== prev.adjuster_name ||
          newAdjPhone !== prev.adjuster_phone
        ) {
          return {
            ...prev,
            customer_email: newEmail,
            customer_phone: newPhone,
            property_address: address,
            insurance_company: newIns,
            claim_number: newClaim,
            adjuster_name: newAdjName,
            adjuster_phone: newAdjPhone
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
        customer_name: estimate.customer_name || "",
        customer_email: estimate.customer_email || "",
        customer_phone: estimate.customer_phone || "",
        property_address: estimate.property_address || "",
        reference_number: estimate.reference_number || "",
        insurance_company: estimate.insurance_company || "",
        adjuster_name: estimate.adjuster_name || "",
        adjuster_phone: estimate.adjuster_phone || "",
        claim_number: estimate.claim_number || "",
        notes: estimate.notes || "",
        status: estimate.status || "draft",
        valid_until: validUntil,
        format_id: estimate.format_id || "",
        category: estimate.category || "",
        tags: estimate.tags || [],
        discount_type: estimate.discount_type || "none",
        discount_value: Number(estimate.discount_value) || 0,
        adjustment_amount: Number(estimate.adjustment_amount) || 0,
        financing_enabled: estimate.financing_enabled || false,
      });

      if (estimate.customer_id) {
        setSelectedContactId(estimate.customer_id);
        setSelectedContactType('customer');
      } else if (estimate.lead_id) {
        setSelectedContactId(estimate.lead_id);
        setSelectedContactType('lead');
      }
      
      const items = estimate.items || [];
      const recalculatedItems = items.map(item => {
        const qty = Number(item.quantity) || 0;
        const rate = Number(item.rate) || 0;
        const depPercent = Number(item.depreciation_percent) || 0;
        
        const rcv = qty * rate;
        const acv = rcv * (1 - depPercent / 100);
        const amount = rcv;
        
        return {
          ...item,
          quantity: qty,
          rate: rate,
          rcv: rcv,
          acv: acv,
          amount: amount,
          depreciation_percent: depPercent
        };
      });
      
      setLineItems(recalculatedItems);
      setLoadedEstimateId(estimate.id);
    }
  }, [estimate]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const subtotal = lineItems.reduce((sum, item) => sum + Number(item.rcv || item.amount || 0), 0);
      
      let discount = 0;
      if (data.discount_type === "percentage") {
        discount = subtotal * (data.discount_value / 100);
      } else if (data.discount_type === "fixed") {
        discount = data.discount_value;
      }
      
      const afterDiscount = subtotal - discount;
      const totalAmount = afterDiscount + (data.adjustment_amount || 0);
      
      let updatedEstimate;
      if (estimateId) {
        // Updating existing estimate
        updatedEstimate = await base44.entities.Estimate.update(estimateId, {
          ...data,
          items: lineItems,
          amount: totalAmount,
          total_amount: totalAmount
        });
      } else {
        // Creating new estimate
        updatedEstimate = await base44.entities.Estimate.create({
          ...data,
          company_id: myCompany?.id,
          items: lineItems,
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
            items: lineItems || [],
            amount: totalAmount || 0,
            total_rcv: totalAmount || 0,
            total_acv: lineItems.reduce((sum, item) => sum + (Number(item.acv) || 0), 0),
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

      return updatedEstimate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['estimate-versions', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
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
      const { currentFormData, currentLineItems, currentEstimate, currentContactId, currentContactType, currentCompany, currentFormat } = payload;

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
      const totalAcv = currentLineItems.reduce((acc, i) => acc + (Number(i.acv) || 0), 0);
      
      let discount = 0;
      if (currentFormData.discount_type === "percentage") {
        discount = subtotalRcv * (Number(currentFormData.discount_value) / 100);
      } else if (currentFormData.discount_type === "fixed") {
        discount = Number(currentFormData.discount_value) || 0;
      }
      
      const afterDiscount = subtotalRcv - discount;
      const totalRcv = afterDiscount + (Number(currentFormData.adjustment_amount) || 0);
      
      let pdfBase64 = null;
      const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
      try {
          const pdfResponse = await base44.functions.invoke('generateEstimatePDF', {
            estimate: {
              ...currentEstimate,
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
              notes: currentFormData.notes
            },
            format: currentFormat,
            returnBase64: true,
            impersonated_company_id: impersonatedId || undefined
          });

          if (pdfResponse.data && pdfResponse.data.base64) {
            pdfBase64 = pdfResponse.data.base64;
          }
      } catch (pdfError) {
          console.error("Failed to generate PDF for attachment:", pdfError);
      }
      
      await base44.functions.invoke('sendEstimateEmail', {
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      alert('✅ Estimate email sent successfully!');
    },
    onError: (error) => {
      alert('❌ Failed to send estimate: ' + error.message);
    }
  });

  const sendSmsMutation = useMutation({
    mutationFn: async () => {
      if (!myCompany) throw new Error("Please set up your company profile first!");

      let phone = formData.customer_phone;
      if (!phone && selectedContactId) {
        try {
          let contact;
          if (selectedContactType === 'customer') {
            const res = await base44.entities.Customer.filter({ id: selectedContactId });
            contact = res[0];
          } else if (selectedContactType === 'lead') {
            const res = await base44.entities.Lead.filter({ id: selectedContactId });
            contact = res[0];
          }
          if (contact?.phone) phone = contact.phone;
        } catch (e) {
          console.error("Failed to auto-fetch customer phone", e);
        }
      }

      if (!phone) throw new Error("No phone number found for this customer. Please add one first.");

      const subtotalRcv = lineItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
      let discount = 0;
      if (formData.discount_type === "percentage") {
        discount = subtotalRcv * (Number(formData.discount_value) / 100);
      } else if (formData.discount_type === "fixed") {
        discount = Number(formData.discount_value) || 0;
      }
      const totalRcvSms = subtotalRcv - discount + (Number(formData.adjustment_amount) || 0);

      const companyName = myCompany.company_name || 'Your roofing contractor';
      const estNum = estimate?.estimate_number || 'N/A';
      const address = formData.property_address ? `📍 ${formData.property_address}\n` : '';
      const message =
        `Hi ${formData.customer_name || 'there'}! ${companyName} has sent you an estimate.\n\n` +
        `Estimate #${estNum}\n` +
        address +
        `💰 Total: $${totalRcvSms.toFixed(2)}\n\n` +
        `Reply or call us with any questions!`;

      const result = await base44.functions.invoke('sendSMS', {
        to: phone,
        body: message,
        companyId: myCompany.id,
        contactName: formData.customer_name
      });

      if (result.error) throw new Error(result.error);

      if (estimate?.id) {
        await base44.entities.Estimate.update(estimate.id, { status: 'sent' }).catch(() => {});
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate', estimateId] });
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      alert('✅ Estimate sent via text message!');
    },
    onError: (error) => {
      alert('❌ Failed to send SMS: ' + error.message);
    }
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
      alert('✅ Estimate converted to invoice successfully!');
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

  // N.E.W.S. - Upload a photo to the linked inspection job (or directly to estimate)
  const uploadNewsPhotoMutation = useMutation({
    mutationFn: async ({ file, section }) => {
      const entityId = linkedInspectionJob?.id || estimateId;
      const entityType = linkedInspectionJob?.id ? 'InspectionJob' : 'Estimate';
      if (!entityId) throw new Error('Save the estimate first before uploading photos');
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      return base44.entities.JobMedia.create({
        related_entity_id: entityId,
        related_entity_type: entityType,
        file_url,
        file_type: 'photo',
        section,
        uploaded_by_name: user?.full_name || 'User',
        company_id: myCompany?.id,
      });
    },
    onSuccess: () => {
      refetchNewsPhotos();
    },
    onError: (err) => {
      alert('Upload failed: ' + (err.message || 'Unknown error'));
    },
  });

  const handleSave = async () => {
    if (!formData.customer_name) {
      alert("Please enter a customer name");
      return;
    }

    let finalContactId = selectedContactId;
    let finalContactType = selectedContactType;

    // If creating new estimate and no contact selected, auto-create customer
    if (!estimateId && !finalContactId && formData.customer_name) {
      try {
        const newContact = await createContactMutation.mutateAsync({
          type: 'customer',
          name: formData.customer_name,
          email: formData.customer_email,
          phone: formData.customer_phone,
          street: formData.property_address?.split(',')[0]?.trim() || '',
          city: formData.property_address?.split(',')[1]?.trim() || '',
          state: formData.property_address?.split(',')[2]?.trim().split(' ')[0]?.trim() || '',
          zip: formData.property_address?.split(',')[2]?.trim().split(' ')[1]?.trim() || '',
        });
        finalContactId = newContact.id;
        finalContactType = 'customer';
      } catch (error) {
        console.error('Auto-create customer failed:', error);
        return;
      }
    }

    if (!estimateId && !finalContactId) {
      alert("⚠️ Please select or create a customer/lead first");
      return;
    }
    
    const saveData = {
      ...formData,
      customer_id: finalContactId && finalContactType === 'customer' ? finalContactId : estimate?.customer_id,
      lead_id: finalContactId && finalContactType === 'lead' ? finalContactId : estimate?.lead_id,
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
      currentFormat: currentFormat
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
    if (!estimate?.id) {
      alert('No estimate loaded');
      return;
    }

    setIsExporting(true);
    try {
      const response = await base44.functions.invoke('exportToXactimate', {
        estimateId: estimate.id
      });

      const blob = new Blob([response.data], { type: 'application/xml' });
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `${estimate.estimate_number || 'estimate'}.esx`;
      document.body.appendChild(a);
      a.click();

      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      alert('✅ Xactimate ESX file downloaded! You can now open it in Xactimate desktop software.');
    } catch (error) {
      console.error('Export error:', error);
      alert(`❌ Export failed: ${error.message}`);
    }
    setIsExporting(false);
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
          line_items: lineItems,
          total_rcv: lineItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0),
          total_acv: lineItems.reduce((acc, i) => acc + (Number(i.acv) || 0), 0)
        },
        customerInfo: {
          customer_name: formData.customer_name,
          customer_email: formData.customer_email,
          customer_phone: formData.customer_phone,
          property_address: formData.property_address,
          insurance_company: formData.insurance_company,
          claim_number: formData.claim_number,
          notes: formData.notes
        },
        format: currentFormat,
        returnBase64: true,
        impersonated_company_id: impersonatedId || undefined
      });

      if (response.data && response.data.base64) {
        const byteCharacters = atob(response.data.base64);
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
      console.log('🖨️ Preview PDF — format:', currentFormat?.format_name, '| format_id:', formData.format_id);
      const response = await base44.functions.invoke('generateEstimatePDF', {
        estimate: {
          ...estimate,
          format_id: formData.format_id || estimate.format_id,
          line_items: lineItems,
          total_rcv: lineItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0),
          total_acv: lineItems.reduce((acc, i) => acc + (Number(i.acv) || 0), 0)
        },
        customerInfo: {
          customer_name: formData.customer_name,
          customer_email: formData.customer_email,
          customer_phone: formData.customer_phone,
          property_address: formData.property_address,
          insurance_company: formData.insurance_company,
          claim_number: formData.claim_number,
          notes: formData.notes
        },
        format: currentFormat,
        returnBase64: true,
        impersonated_company_id: impersonatedId || undefined
      });

      if (response.data && response.data.base64) {
        const byteCharacters = atob(response.data.base64);
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

  const handleGenerateMaterialList = async () => {
    if (!lineItems || lineItems.length === 0) {
      alert('No line items to generate material list from');
      return;
    }
    setIsGeneratingMaterials(true);
    try {
      const tempEstimate = {
        items: lineItems,
        estimate_number: estimate?.estimate_number || 'DRAFT',
        customer_name: formData.customer_name,
        property_address: formData.property_address
      };
      const response = await generateMaterialList({
        estimateId: estimate?.id || null,
        estimate: tempEstimate
      });
      if (!response || !response.success) {
        throw new Error(response?.error || 'Material list generation failed');
      }
      setMaterialListData(response);
      setShowMaterialList(true);
    } catch (error) {
      console.error('Material list error:', error);
      alert(`Failed to generate material list: ${error.message}`);
    } finally {
      setIsGeneratingMaterials(false);
    }
  };

  const downloadMaterialListCSV = () => {
    if (!materialListData) return;
    let csv = 'MATERIALS TO PURCHASE\n\n';
    csv += `Customer: ${materialListData.estimate.customer_name}\n`;
    csv += `Address: ${materialListData.estimate.property_address}\n\n`;
    csv += 'Material,Qty to Buy,Unit,Notes\n';
    materialListData.material_calculations.forEach(item => {
      csv += `"${item.material}",${item.quantity},"${item.purchaseUnit || item.unit}","${item.notes}"\n`;
    });
    csv += `\n\nGrand Total:,$${materialListData.totals.grand_total.toFixed(2)}\n`;
    const blob = new Blob([csv], { type: 'text/csv' });
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
    if (!formatId || formatId === 'none') return null;
    return customFormats.find(f => String(f.id) === String(formatId));
  };

  const currentFormat = getFormatForSource(formData.format_id);

  const isInsuranceJob = !!(formData.insurance_company || formData.claim_number);

  const subtotal = lineItems.reduce((sum, item) => sum + Number(item.rcv || item.amount || 0), 0);
  
  let discount = 0;
  if (formData.discount_type === "percentage") {
    discount = subtotal * (Number(formData.discount_value) / 100);
  } else if (formData.discount_type === "fixed") {
    discount = Number(formData.discount_value) || 0;
  }
  
  const afterDiscount = subtotal - discount;
  const totalRcv = afterDiscount + (Number(formData.adjustment_amount) || 0);

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

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={() => navigate(createPageUrl('Estimates'))}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Estimates
          </Button>
          <h1 className="text-3xl font-bold text-gray-900">
            {estimate.estimate_number || 'New Estimate'}
          </h1>
          {estimateVersions.length > 0 && (
            <Badge variant="outline" className="gap-1">
              <History className="w-3 h-3" />
              v{estimateVersions.length}
            </Badge>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              const params = new URLSearchParams({
                customer_name: formData.customer_name || '',
                customer_email: formData.customer_email || '',
                customer_phone: formData.customer_phone || '',
                property_address: formData.property_address || '',
                insurance_company: formData.insurance_company || '',
                claim_number: formData.claim_number || '',
              });
              navigate(createPageUrl('AIEstimator') + '?' + params.toString());
            }}
            className="bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Open AI Estimator
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <MoreVertical className="w-4 h-4 mr-2" />
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
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
              <DropdownMenuItem onClick={handleExportToXactimate} disabled={isExporting || !estimate}>
                {isExporting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                    Exporting...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Export to Xactimate
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => navigate(createPageUrl('AIEstimator') + `?merge_target_id=${estimateId}`)}
                disabled={!estimateId}
              >
                <Sparkles className="w-4 h-4 mr-2 text-purple-600" />
                Add AI-Generated Items
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
          <div className="flex">
            <Button
              onClick={handleSendEstimate}
              disabled={sendMutation.isPending || sendSmsMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 rounded-r-none border-r border-blue-500"
            >
              <Mail className="w-4 h-4 mr-2" />
              {sendMutation.isPending ? 'Sending...' : 'Send to Customer'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="bg-blue-600 hover:bg-blue-700 rounded-l-none px-2"
                  disabled={sendMutation.isPending || sendSmsMutation.isPending}
                >
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleSendEstimate} disabled={sendMutation.isPending}>
                  <Mail className="w-4 h-4 mr-2 text-blue-600" />
                  Send via Email
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => sendSmsMutation.mutate()}
                  disabled={sendSmsMutation.isPending}
                >
                  <MessageSquare className="w-4 h-4 mr-2 text-green-600" />
                  {sendSmsMutation.isPending ? 'Sending...' : 'Send via Text (SMS)'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

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
                      <div className="font-medium">{formData.customer_name}</div>
                      <div className="text-sm text-gray-600">
                        <Badge variant={selectedContactType === 'customer' ? 'default' : 'secondary'} className="mr-2">
                          {selectedContactType}
                        </Badge>
                        {formData.customer_email || formData.customer_phone}
                      </div>
                    </div>
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
                    disabled={!selectedContactId && !allowCustomerEdit}
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
                <Label>Notes</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  placeholder="Internal notes..."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Estimate Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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

              <div>
                <Label>Format Template</Label>
                <Select 
                  value={formData.format_id || 'none'} 
                  onValueChange={(value) => {
                    const newFormatId = value === 'none' ? '' : value;
                    setFormData({...formData, format_id: newFormatId});
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Standard Format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Standard Format</SelectItem>
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

        {/* ── Satellite View (Xoom) ─────────────────────────────────── */}
        <Card className="lg:col-span-4">
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => setSatelliteExpanded(prev => !prev)}
          >
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-blue-600" />
                Satellite View
                {formData.property_address && (
                  <Badge variant="outline" className="text-xs font-normal text-gray-500">
                    {formData.property_address.split(',')[0]}
                  </Badge>
                )}
              </div>
              {satelliteExpanded ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </CardTitle>
          </CardHeader>
          {satelliteExpanded && (
            <CardContent className="p-0">
              {!formData.property_address ? (
                <div className="text-center py-10 text-gray-400">
                  <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Enter a property address to see the satellite view.</p>
                </div>
              ) : (() => {
                const encoded = encodeURIComponent(formData.property_address);
                const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
                const streetUrl = `https://www.google.com/maps?q=${encoded}&layer=c&cbll=0,0`;
                const embedSrc = `https://www.google.com/maps/embed/v1/place?key=${mapsApiKey}&q=${encoded}&maptype=satellite&zoom=19`;
                return (
                  <div>
                    {mapsApiKey ? (
                      <iframe
                        title="Property Satellite View"
                        src={embedSrc}
                        className="w-full h-80 border-0"
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        data-testid="iframe-satellite-view"
                      />
                    ) : (
                      <div className="bg-gray-100 rounded-b-lg h-64 flex flex-col items-center justify-center gap-3">
                        <MapPin className="w-10 h-10 text-blue-500 opacity-60" />
                        <p className="text-sm text-gray-600 font-medium">{formData.property_address}</p>
                        <p className="text-xs text-gray-400">Configure GOOGLE_MAPS_API_KEY in Secrets to enable satellite embed</p>
                      </div>
                    )}
                    <div className="flex gap-3 p-3 border-t bg-gray-50 rounded-b-lg">
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 underline hover:text-blue-800 flex items-center gap-1"
                        data-testid="link-open-google-maps"
                      >
                        <MapPin className="w-3 h-3" /> Open in Google Maps
                      </a>
                      <a
                        href={streetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 underline hover:text-blue-800 flex items-center gap-1"
                        data-testid="link-open-street-view"
                      >
                        <Eye className="w-3 h-3" /> Street View
                      </a>
                      <a
                        href={createPageUrl('AIEstimator') + `?address=${encodeURIComponent(formData.property_address)}&mode=satellite`}
                        className="text-xs text-purple-600 underline hover:text-purple-800 flex items-center gap-1 ml-auto font-medium"
                        data-testid="link-open-xoom-drawing"
                      >
                        🛰️ Open Xoom Drawing Mode
                      </a>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          )}
        </Card>

        {/* ── Roof Accessories (from linked Crew Cam job) ────────────── */}
        {linkedInspectionJob?.roof_accessories && (() => {
          let acc = null;
          try { acc = typeof linkedInspectionJob.roof_accessories === 'string' ? JSON.parse(linkedInspectionJob.roof_accessories) : linkedInspectionJob.roof_accessories; } catch {}
          if (!acc) return null;
          const items = [
            acc.vents > 0 && { label: 'Vents', value: acc.vents },
            acc.pipe_boots > 0 && { label: 'Pipe Boots', value: acc.pipe_boots },
            acc.chimneys > 0 && { label: 'Chimneys', value: acc.chimneys },
            acc.drip_edge && { label: 'Drip Edge', value: 'Yes' },
            acc.ice_guard && { label: 'Ice Guard', value: 'Yes' },
          ].filter(Boolean);
          if (!items.length) return null;
          return (
            <Card className="lg:col-span-4 border-amber-200 bg-amber-50">
              <CardContent className="p-3 flex flex-wrap gap-3 items-center">
                <span className="text-sm font-semibold text-amber-800">🪛 Roof Accessories</span>
                {items.map(({ label, value }) => (
                  <span key={label} className="text-xs bg-white border border-amber-300 text-amber-800 px-2 py-1 rounded-full font-medium">
                    {label}: {value}
                  </span>
                ))}
              </CardContent>
            </Card>
          );
        })()}

        {/* ── N.E.W.S. Elevation Photos ─────────────────────────────── */}
        <Card className="lg:col-span-4">
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => setNewsExpanded(prev => !prev)}
          >
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-blue-600" />
                N.E.W.S. Elevation Photos
                {linkedInspectionJob && (
                  <Badge className="bg-green-100 text-green-700 border border-green-300 text-xs">
                    <Link2 className="w-3 h-3 mr-1" />
                    Linked Job #{linkedInspectionJob.id?.slice(-6)?.toUpperCase()}
                  </Badge>
                )}
                {newsPhotos.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {newsPhotos.length} photo{newsPhotos.length !== 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
              {newsExpanded ? (
                <ChevronUp className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              )}
            </CardTitle>
          </CardHeader>
          {newsExpanded && (
            <CardContent>
              {linkedInspectionJob && (
                <p className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-1 mb-3">
                  📷 Photos are saved to Crew Cam job #{linkedInspectionJob.id?.slice(-6)?.toUpperCase()}
                </p>
              )}
              {!linkedInspectionJob && !estimateId && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-3">
                  ⚠️ Save the estimate first to enable photo uploads.
                </p>
              )}
                <div className="space-y-4">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { section: 'Front Elevation', compass: 'N', icon: '⬆️', headerClass: 'bg-blue-50' },
                      { section: 'Right Elevation', compass: 'E', icon: '➡️', headerClass: 'bg-green-50' },
                      { section: 'Rear Elevation',  compass: 'S', icon: '⬇️', headerClass: 'bg-orange-50' },
                      { section: 'Left Elevation',  compass: 'W', icon: '⬅️', headerClass: 'bg-purple-50' },
                    ].map(({ section, compass, icon, headerClass }) => {
                      const photos = newsPhotos.filter(p => p.section === section);
                      const isUploading = uploadingSection === section;
                      const inputId = `news-upload-${section.replace(/\s+/g, '-')}`;
                      return (
                        <div key={section} className="border rounded-lg overflow-hidden flex flex-col">
                          {/* Section header */}
                          <div className={`${headerClass} border-b px-3 py-2 flex items-center gap-2`}>
                            <span className="text-base">{icon}</span>
                            <div>
                              <p className="text-xs font-bold text-gray-800">{compass} — {section}</p>
                            </div>
                          </div>

                          {/* Photos */}
                          <div className="flex-1 p-2 space-y-2 bg-white min-h-[100px]">
                            {photos.length === 0 ? (
                              <div className="flex items-center justify-center h-20 text-gray-300 text-xs">
                                No photos yet
                              </div>
                            ) : (
                              <div className="grid grid-cols-2 gap-1">
                                {photos.slice(0, 6).map((photo, idx) => (
                                  <button
                                    key={photo.id || idx}
                                    onClick={() => setSelectedNewsPhoto(photo)}
                                    className="block w-full aspect-square rounded overflow-hidden border hover:opacity-90 transition-opacity"
                                    data-testid={`img-news-${section.toLowerCase().replace(/\s+/g,'-')}-${idx}`}
                                  >
                                    <img
                                      src={photo.file_url}
                                      alt={`${section} ${idx + 1}`}
                                      className="w-full h-full object-cover"
                                    />
                                  </button>
                                ))}
                                {photos.length > 6 && (
                                  <div className="flex items-center justify-center aspect-square rounded bg-gray-100 text-xs text-gray-500 font-medium">
                                    +{photos.length - 6} more
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Upload button */}
                          <div className="p-2 border-t bg-gray-50">
                            <input
                              id={inputId}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                setUploadingSection(section);
                                try {
                                  await uploadNewsPhotoMutation.mutateAsync({ file, section });
                                } finally {
                                  setUploadingSection(null);
                                  e.target.value = '';
                                }
                              }}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full text-xs"
                              disabled={isUploading}
                              onClick={() => document.getElementById(inputId)?.click()}
                              data-testid={`button-upload-${section.toLowerCase().replace(/\s+/g,'-')}`}
                            >
                              {isUploading ? (
                                <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Uploading…</>
                              ) : (
                                <><Upload className="w-3 h-3 mr-1" />Add Photo</>
                              )}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-400">
                    {linkedInspectionJob
                      ? `Photos saved to Crew Cam job #${linkedInspectionJob.id?.slice(-6)?.toUpperCase()}. All team members can view them there.`
                      : 'Photos are saved directly to this estimate.'}
                  </p>
                </div>
            </CardContent>
          )}
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Line Items
              {(formData.insurance_company || formData.claim_number) && lineItems.some(i => i.action || i.xactimate_code || i.remove_rate || i.replace_rate) && (
                <Badge className="bg-orange-100 text-orange-700 text-xs gap-1">
                  <Shield className="w-3 h-3" />
                  Xactimate Format
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LineItemEditor
              items={lineItems}
              onChange={setLineItems}
              format={currentFormat}
            />

            {isInsuranceJob && lineItems.some(i => i.action || i.xactimate_code || i.remove_rate || i.replace_rate) && (() => {
              const catTotals = {};
              let liTotal = 0, taxTotal = 0, rcvTotal = 0;
              lineItems.forEach(item => {
                const qty = parseFloat(item.quantity) || 0;
                const removeRate = parseFloat(item.remove_rate) || 0;
                const replaceRate = parseFloat(item.replace_rate) || (item.action === '-' ? 0 : parseFloat(item.rate) || 0);
                const taxPct = parseFloat(item.tax_rate) || 0;
                const removeLine = qty * removeRate;
                const replaceLine = qty * replaceRate;
                const taxLine = replaceLine * (taxPct / 100);
                const totalLine = removeLine + replaceLine + taxLine;
                liTotal += removeLine + replaceLine;
                taxTotal += taxLine;
                rcvTotal += totalLine;
                const cat = (item.xactimate_code || '').split(' ')[0] || 'OTHER';
                catTotals[cat] = (catTotals[cat] || 0) + totalLine;
              });
              const catLabels = { RFG: 'Roofing', DML: 'Demolition', GUT: 'Gutters', WTR: 'Waterproofing', STR: 'Structure', OTHER: 'Other' };
              return (
                <div className="mt-4 border border-orange-200 rounded-lg bg-orange-50/40 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 bg-orange-100 border-b border-orange-200">
                    <Shield className="w-4 h-4 text-orange-600" />
                    <span className="text-sm font-semibold text-orange-800">Xactimate Format (Insurance Claim View)</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-800 text-white">
                          <th className="px-2 py-2 text-left font-semibold">CODE</th>
                          <th className="px-2 py-2 text-center font-semibold">ACT</th>
                          <th className="px-2 py-2 text-left font-semibold">DESCRIPTION</th>
                          <th className="px-2 py-2 text-center font-semibold">QTY</th>
                          <th className="px-2 py-2 text-center font-semibold">UNIT</th>
                          <th className="px-2 py-2 text-right font-semibold">REMOVE RATE</th>
                          <th className="px-2 py-2 text-right font-semibold">REPLACE RATE</th>
                          <th className="px-2 py-2 text-right font-semibold">TAX</th>
                          <th className="px-2 py-2 text-right font-semibold">TOTAL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lineItems.map((item, idx) => {
                          const qty = parseFloat(item.quantity) || 0;
                          const removeRate = parseFloat(item.remove_rate) || 0;
                          const replaceRate = parseFloat(item.replace_rate) || (item.action === '-' ? 0 : parseFloat(item.rate) || 0);
                          const taxPct = parseFloat(item.tax_rate) || 0;
                          const removeLine = qty * removeRate;
                          const replaceLine = qty * replaceRate;
                          const taxLine = replaceLine * (taxPct / 100);
                          const totalLine = removeLine + replaceLine + taxLine;
                          const action = item.action || '+';
                          const actionColor = action === '-' ? 'text-red-600 border-red-500' : action === 'R&R' ? 'text-orange-600 border-orange-500' : 'text-green-600 border-green-500';
                          return (
                            <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{item.xactimate_code || item.code || ''}</td>
                              <td className="px-2 py-1.5 text-center">
                                <span className={`inline-block px-1 py-0 text-xs font-bold border rounded ${actionColor}`}>{action}</span>
                              </td>
                              <td className="px-2 py-1.5">{item.description}</td>
                              <td className="px-2 py-1.5 text-center">{qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2)}</td>
                              <td className="px-2 py-1.5 text-center text-gray-500">{item.unit || 'EA'}</td>
                              <td className="px-2 py-1.5 text-right">{removeRate > 0 ? `$${removeRate.toFixed(2)}` : '—'}</td>
                              <td className="px-2 py-1.5 text-right">{replaceRate > 0 ? `$${replaceRate.toFixed(2)}` : '—'}</td>
                              <td className="px-2 py-1.5 text-right text-gray-500">{taxLine > 0 ? `$${taxLine.toFixed(2)}` : '—'}</td>
                              <td className="px-2 py-1.5 text-right font-semibold">${totalLine.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-3 border-t border-orange-200 flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                      <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Summary for Dwelling</p>
                      <div className="border border-slate-200 rounded overflow-hidden max-w-xs text-xs">
                        <div className="flex justify-between px-3 py-1.5 bg-white">
                          <span className="text-gray-600">Line Item Total</span>
                          <span className="font-semibold">${liTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between px-3 py-1.5 bg-gray-50 border-t border-slate-100">
                          <span className="text-gray-600">Total Tax</span>
                          <span className="font-semibold">${taxTotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between px-3 py-2 bg-blue-900 text-white border-t border-slate-200">
                          <span className="font-bold">RCV — Net Claim</span>
                          <span className="font-bold">${rcvTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                    {Object.keys(catTotals).length > 0 && (
                      <div className="flex-1">
                        <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">Recap by Category</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(catTotals).map(([cat, total]) => (
                            <div key={cat} className="bg-white border border-orange-200 rounded px-3 py-1.5 text-center">
                              <div className="text-xs text-gray-500">{catLabels[cat] || cat}</div>
                              <div className="text-sm font-bold text-gray-900">${total.toFixed(2)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="mt-6 pt-4 border-t space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg space-y-4">
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
                    const subtotal = lineItems.reduce((sum, item) => sum + Number(item.rcv || item.amount || 0), 0);
                    let discount = 0;
                    if (formData.discount_type === "percentage") {
                      discount = subtotal * (formData.discount_value / 100);
                    } else if (formData.discount_type === "fixed") {
                      discount = formData.discount_value;
                    }
                    const afterDiscount = subtotal - discount;
                    const total = afterDiscount + (formData.adjustment_amount || 0);

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
                        {formData.adjustment_amount !== 0 && (
                          <div className={`flex justify-between ${formData.adjustment_amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            <span>Adjustment:</span>
                            <span>{formData.adjustment_amount > 0 ? '+' : ''}${Number(formData.adjustment_amount || 0).toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-lg font-bold border-t pt-2">
                          <span>Total:</span>
                          <span>${total.toFixed(2)}</span>
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
              <Button
                variant="outline"
                onClick={() => navigate(createPageUrl('Estimates'))}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

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
                        onClick={() => {
                          alert('Preview feature coming soon!');
                        }}
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
      <Dialog open={showMaterialList} onOpenChange={setShowMaterialList}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-green-600" />
              Material Purchase List
            </DialogTitle>
            <DialogDescription>
              {materialListData?.estimate?.customer_name && `For: ${materialListData.estimate.customer_name}`}
            </DialogDescription>
          </DialogHeader>

          {materialListData && (
            <div className="space-y-6">
              {materialListData.material_calculations && materialListData.material_calculations.length > 0 && (
                <div className="bg-gradient-to-r from-blue-50 to-green-50 p-6 rounded-lg border-2 border-blue-300">
                  <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    🛒 Materials to Purchase
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {materialListData.material_calculations.map((calc, idx) => (
                      <div key={idx} className="bg-white p-4 rounded-lg shadow-sm border-l-4 border-blue-500">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-bold text-lg text-gray-900">{calc.material}</h3>
                          <Badge className="ml-auto bg-blue-600 text-white text-lg px-3 py-1">
                            {calc.quantity} {calc.purchaseUnit || calc.unit}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">
                          <strong>Calculation:</strong> {calc.calculation}
                        </p>
                        <p className="text-xs text-gray-500 italic">{calc.notes}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Materials Breakdown */}
              {materialListData.materials && materialListData.materials.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                      📦 Materials Breakdown
                      <Badge variant="outline">{materialListData.materials.length} items</Badge>
                    </h3>
                    <Badge className="bg-green-100 text-green-700">
                      ${Number(materialListData.totals?.materials || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}
                    </Badge>
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-4 py-2 text-left text-sm font-semibold">Code</th>
                          <th className="px-4 py-2 text-left text-sm font-semibold">Description</th>
                          <th className="px-4 py-2 text-right text-sm font-semibold">Qty</th>
                          <th className="px-4 py-2 text-right text-sm font-semibold">Unit</th>
                          <th className="px-4 py-2 text-right text-sm font-semibold">Rate</th>
                          <th className="px-4 py-2 text-right text-sm font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {materialListData.materials.map((item, idx) => {
                          const calc = materialListData.material_calculations?.find(c => {
                            const itemDesc = (item.description || item.name || '').toLowerCase();
                            const calcMaterial = (c.material || '').toLowerCase();
                            if (itemDesc.includes('shingle') && !itemDesc.includes('cap') && calcMaterial.includes('shingle') && !calcMaterial.includes('cap')) return true;
                            if ((itemDesc.includes('ridge') || itemDesc.includes('hip')) && (calcMaterial.includes('ridge') || calcMaterial.includes('hip'))) return true;
                            if (itemDesc.includes('valley') && calcMaterial.includes('valley')) return true;
                            if ((itemDesc.includes('underlayment') || itemDesc.includes('felt') || itemDesc.includes('synthetic')) && (calcMaterial.includes('underlayment') || calcMaterial.includes('felt') || calcMaterial.includes('synthetic'))) return true;
                            if (itemDesc.includes('drip') && calcMaterial.includes('drip')) return true;
                            if (itemDesc.includes('nail') && calcMaterial.includes('nail')) return true;
                            if (itemDesc.includes('starter') && calcMaterial.includes('starter')) return true;
                            if ((itemDesc.includes('ice') || itemDesc.includes('water shield')) && calcMaterial.includes('ice')) return true;
                            if (itemDesc.includes('step') && itemDesc.includes('flashing') && calcMaterial.includes('step')) return true;
                            return false;
                          });
                          return (
                            <tr key={idx} className="border-b hover:bg-gray-50">
                              <td className="px-4 py-2 text-sm font-mono">{item.code || ''}</td>
                              <td className="px-4 py-2 text-sm">
                                <div>{item.description || item.name}</div>
                                {item.notes && <div className="text-xs text-gray-500 italic">{item.notes}</div>}
                                {calc && (
                                  <div className="text-xs text-blue-700 mt-1 font-medium">
                                    🛒 Buy: {calc.quantity} {calc.purchaseUnit || calc.unit}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-2 text-sm text-right">{Number(item.quantity || 0).toFixed(2)}</td>
                              <td className="px-4 py-2 text-sm text-right">{item.unit}</td>
                              <td className="px-4 py-2 text-sm text-right">${Number(item.rate || item.unitCost || 0).toFixed(2)}</td>
                              <td className="px-4 py-2 text-sm text-right font-semibold">${Number(item.amount || item.totalCost || 0).toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Labor Section */}
              {materialListData.labor && materialListData.labor.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                      👷 Labor & Services
                      <Badge variant="outline">{materialListData.labor.length} items</Badge>
                    </h3>
                    <Badge className="bg-blue-100 text-blue-700">
                      ${Number(materialListData.totals?.labor || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}
                    </Badge>
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-4 py-2 text-left text-sm font-semibold">Code</th>
                          <th className="px-4 py-2 text-left text-sm font-semibold">Description</th>
                          <th className="px-4 py-2 text-right text-sm font-semibold">Qty</th>
                          <th className="px-4 py-2 text-right text-sm font-semibold">Unit</th>
                          <th className="px-4 py-2 text-right text-sm font-semibold">Rate</th>
                          <th className="px-4 py-2 text-right text-sm font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {materialListData.labor.map((item, idx) => (
                          <tr key={idx} className="border-b hover:bg-gray-50">
                            <td className="px-4 py-2 text-sm font-mono">{item.code || ''}</td>
                            <td className="px-4 py-2 text-sm">
                              <div>{item.description || item.name}</div>
                              {item.notes && <div className="text-xs text-gray-500 italic">{item.notes}</div>}
                            </td>
                            <td className="px-4 py-2 text-sm text-right">{Number(item.quantity || 0).toFixed(2)}</td>
                            <td className="px-4 py-2 text-sm text-right">{item.unit}</td>
                            <td className="px-4 py-2 text-sm text-right">${Number(item.rate || item.unitCost || 0).toFixed(2)}</td>
                            <td className="px-4 py-2 text-sm text-right font-semibold">${Number(item.amount || item.totalCost || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Other Items Section */}
              {materialListData.other && materialListData.other.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                      📋 Other
                      <Badge variant="outline">{materialListData.other.length} items</Badge>
                    </h3>
                    <Badge className="bg-gray-100 text-gray-700">
                      ${Number(materialListData.totals?.other || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}
                    </Badge>
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-4 py-2 text-left text-sm font-semibold">Code</th>
                          <th className="px-4 py-2 text-left text-sm font-semibold">Description</th>
                          <th className="px-4 py-2 text-right text-sm font-semibold">Qty</th>
                          <th className="px-4 py-2 text-right text-sm font-semibold">Unit</th>
                          <th className="px-4 py-2 text-right text-sm font-semibold">Rate</th>
                          <th className="px-4 py-2 text-right text-sm font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {materialListData.other.map((item, idx) => (
                          <tr key={idx} className="border-b hover:bg-gray-50">
                            <td className="px-4 py-2 text-sm font-mono">{item.code || ''}</td>
                            <td className="px-4 py-2 text-sm">
                              <div>{item.description || item.name}</div>
                              {item.notes && <div className="text-xs text-gray-500 italic">{item.notes}</div>}
                            </td>
                            <td className="px-4 py-2 text-sm text-right">{Number(item.quantity || 0).toFixed(2)}</td>
                            <td className="px-4 py-2 text-sm text-right">{item.unit}</td>
                            <td className="px-4 py-2 text-sm text-right">${Number(item.rate || item.unitCost || 0).toFixed(2)}</td>
                            <td className="px-4 py-2 text-sm text-right font-semibold">${Number(item.amount || item.totalCost || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Totals Summary */}
              <div className="bg-gradient-to-r from-green-50 to-blue-50 p-6 rounded-lg border-2 border-green-200">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Materials:</span>
                    <span className="font-semibold">${Number(materialListData.totals?.materials || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Labor:</span>
                    <span className="font-semibold">${Number(materialListData.totals?.labor || 0).toFixed(2)}</span>
                  </div>
                  {(materialListData.totals?.other || 0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Other:</span>
                      <span className="font-semibold">${Number(materialListData.totals.other).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg font-bold pt-3 border-t-2 border-green-300">
                    <span className="text-gray-900">Grand Total:</span>
                    <span className="text-green-700">${Number(materialListData.totals?.grand_total || 0).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <Button onClick={downloadMaterialListCSV} className="flex-1 bg-green-600 hover:bg-green-700">
                  <Download className="w-4 h-4 mr-2" />
                  Download CSV
                </Button>
                <Button onClick={() => setShowMaterialList(false)} variant="outline" className="flex-1">
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* N.E.W.S. Photo Lightbox */}
      {selectedNewsPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setSelectedNewsPhoto(null)}
          data-testid="overlay-news-lightbox"
        >
          <div
            className="relative max-w-4xl max-h-[90vh] w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedNewsPhoto(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300 transition-colors"
              data-testid="button-close-lightbox"
            >
              <X className="w-8 h-8" />
            </button>
            <img
              src={selectedNewsPhoto.file_url}
              alt={selectedNewsPhoto.section || 'Elevation photo'}
              className="w-full h-auto max-h-[85vh] object-contain rounded-lg"
              data-testid="img-news-lightbox"
            />
            {(selectedNewsPhoto.section || selectedNewsPhoto.caption) && (
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white p-3 rounded-b-lg">
                {selectedNewsPhoto.section && (
                  <p className="text-sm font-semibold">{selectedNewsPhoto.section}</p>
                )}
                {selectedNewsPhoto.caption && (
                  <p className="text-xs text-gray-300 mt-0.5">{selectedNewsPhoto.caption}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}