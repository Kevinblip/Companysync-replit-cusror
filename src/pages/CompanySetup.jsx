import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import DOMPurify from "dompurify";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Save, Upload, Loader2, Plus, X, CalendarCheck, FileText, Globe, Mail, MessageSquare, Eye, EyeOff, Mic, CheckCircle2, ChevronUp, ChevronDown, Layers, Package } from "lucide-react";
import { SHORTCUT_CATALOG } from "@/config/quickCreateShortcuts";
import { PILL_COLOR_MAP } from "@/components/FloatingActionButton";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import useTranslation from "@/hooks/useTranslation";
import { validateE164Phone, formatToE164, looksLikeFormattableUSPhone } from "@/utils";
import { getDefaultAssignmentEmailHTML, getDefaultClientEmailHTML } from "@/utils/defaultEmailTemplates";
import { getSmsStats, MergeFieldLengthWarning } from "@/utils/smsStats";
import { Checkbox } from "@/components/ui/checkbox";
import { DEFAULT_BRANDS } from "@/utils/generateMeasurementReportHTML";

const timezones = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"
];

const REMINDER_SAMPLE_DATA = {
  company_name: "Acme Roofing Co.",
  company_email: "info@acmeroofing.com",
  company_phone: "(555) 100-2000",
  inspector_name: "Alex Johnson",
  inspector_email: "alex.johnson@acmeroofing.com",
  inspector_phone: "(555) 234-5678",
  inspector_photo: "https://avatar.vercel.sh/alex.png",
  property_address: "123 Maple St, Springfield, IL 62701",
  client_name: "Sarah Williams",
  client_phone: "(555) 867-5309",
  client_email: "sarah.williams@example.com",
  scheduled_date: "Thursday, May 2, 2026",
  scheduled_time: "10:00 AM",
  damage_type: "Hail & Wind",
  date_of_loss: "April 15, 2026",
  claim_number: "CLM-2026-00123",
  property_type: "Residential",
  inspection_type: "Property Damage Assessment",
  priority: "High",
  access_instructions: "Key is under the mat at the side gate.",
  crewcam_link: "https://mycrewcam.com/job/preview-link",
};

const DOCUMENT_DEFAULT_FIELDS = [
  'default_estimate_notes',
  'default_estimate_disclaimer',
  'default_invoice_notes',
  'default_invoice_disclaimer',
  'default_proposal_notes',
  'default_proposal_disclaimer',
];

function buildDocumentDefaults(company = {}) {
  const companyName = String(company.company_name || '').trim() || 'your company';
  const contactParts = [
    String(company.phone || '').trim(),
    String(company.email || '').trim(),
  ].filter(Boolean);
  const addressParts = [
    String(company.address || '').trim(),
    [company.city, company.state, company.zip]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(', '),
  ].filter(Boolean);
  const contactDetails = [...contactParts, ...addressParts].filter(Boolean).join(' · ');
  const contactSentence = contactDetails
    ? ` Please contact us at ${contactDetails} with any questions.`
    : '';

  return {
    default_estimate_notes: `Thank you for choosing ${companyName}.${contactSentence}`,
    default_estimate_disclaimer: `This estimate is provided by ${companyName} based on visible and disclosed conditions at the time of preparation. Additional work or changes in site conditions may require written approval and a revised estimate.`,
    default_invoice_notes: `Thank you for choosing ${companyName}.${contactSentence}`,
    default_invoice_disclaimer: `This invoice reflects the work and services provided by ${companyName}. Payment is due according to the agreed terms. Please retain this invoice for your records.`,
    default_proposal_notes: `Thank you for considering ${companyName}.${contactSentence}`,
    default_proposal_disclaimer: `This proposal is prepared by ${companyName} based on the information available at the time of preparation. Scope and pricing may change if project conditions or requirements change. Any changes require written approval.`,
  };
}

function CustomBrandAdder({ onAdd, existingShorts = [] }) {
  const [short, setShort] = useState('');
  const [product, setProduct] = useState('');
  const [bPerSq, setBPerSq] = useState('3');
  const [error, setError] = useState('');
  const add = () => {
    const s = short.trim();
    const p = product.trim();
    if (!s || !p) return;
    if (existingShorts.some(e => e.toLowerCase() === s.toLowerCase())) {
      setError(`"${s}" already exists. Choose a different name.`);
      return;
    }
    setError('');
    onAdd({ short: s, product: p, bPerSq: parseFloat(bPerSq) || 3, undRollSq: 10 });
    setShort(''); setProduct(''); setBPerSq('3');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2 items-end mt-2">
        <div>
          <Label className="text-xs text-gray-500">Brand Name</Label>
          <Input data-testid="input-custom-brand-short" value={short} onChange={e => { setShort(e.target.value); setError(''); }} placeholder="e.g. Atlas" className="h-7 text-xs w-28" />
        </div>
        <div>
          <Label className="text-xs text-gray-500">Product</Label>
          <Input data-testid="input-custom-brand-product" value={product} onChange={e => setProduct(e.target.value)} placeholder="e.g. StormMaster" className="h-7 text-xs w-36" />
        </div>
        <div>
          <Label className="text-xs text-gray-500">Bundles / SQ</Label>
          <Input data-testid="input-custom-brand-bpersq" type="number" step="0.01" min="1" max="10" value={bPerSq} onChange={e => setBPerSq(e.target.value)} className="h-7 text-xs w-20" />
        </div>
        <Button data-testid="btn-add-custom-brand" size="sm" variant="outline" onClick={add} className="h-7 text-xs">
          <Plus className="w-3 h-3 mr-1" /> Add
        </Button>
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function SmsCounter({ text, testId }) {
  const { chars, segments, billedUnits, singleLimit } = getSmsStats(text);
  if (chars === 0) return null;
  const approachThreshold = Math.floor(singleLimit * 0.8);
  const isWarning = billedUnits >= approachThreshold && billedUnits <= singleLimit;
  const isDanger = billedUnits > singleLimit;
  const colorClass = isDanger
    ? "text-red-600 font-semibold"
    : isWarning
    ? "text-amber-600 font-semibold"
    : "text-gray-500";
  return (
    <p
      data-testid={testId}
      className={`text-xs mt-1 ${colorClass}`}
    >
      {chars} chars · {segments} segment{segments !== 1 ? "s" : ""}
    </p>
  );
}

function isTwilioConfigError(msg) {
  if (!msg) return false;
  return (
    msg === 'Twilio credentials not configured' ||
    msg.includes('Twilio credentials not configured') ||
    msg.includes('TWILIO_ACCOUNT_SID') ||
    msg.includes('TWILIO_AUTH_TOKEN') ||
    msg.includes('TWILIO_PHONE_NUMBER') ||
    msg.includes('not configured')
  );
}

function isEmailConfigError(msg) {
  if (!msg) return false;
  return (
    msg === 'EMAIL_NOT_CONFIGURED' ||
    msg.includes('EMAIL_NOT_CONFIGURED') ||
    msg.includes('POSTMARK_SERVER_TOKEN') ||
    msg.includes('AWS SES credentials not configured') ||
    msg.includes('No email provider configured') ||
    msg.includes('No email service') ||
    msg.includes('not configured')
  );
}

function SmsTestStatusFeedback({ status, error, toPhone, successTestId, notConfiguredTestId, errorTestId }) {
  if (status === 'success') {
    return (
      <p data-testid={successTestId || 'text-test-sms-success'} className="text-sm text-green-600">
        Test SMS sent to {toPhone}!
      </p>
    );
  }
  if (status === 'not_configured') {
    return (
      <div data-testid={notConfiguredTestId || 'text-test-sms-not-configured'} className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 max-w-sm text-right">
        <strong>SMS service not configured.</strong> To send SMS messages, set up Twilio credentials (
        <code className="bg-amber-100 px-1 rounded text-xs">TWILIO_ACCOUNT_SID</code>,{' '}
        <code className="bg-amber-100 px-1 rounded text-xs">TWILIO_AUTH_TOKEN</code>,{' '}
        <code className="bg-amber-100 px-1 rounded text-xs">TWILIO_PHONE_NUMBER</code>
        ) or configure Twilio in your Integrations settings.
      </div>
    );
  }
  if (status === 'error') {
    return (
      <p data-testid={errorTestId || 'text-test-sms-error'} className="text-sm text-red-600">
        Failed to send: {error}
      </p>
    );
  }
  return null;
}

function applyReminderMergeFields(text, companyName) {
  if (!text) return "";
  const data = { ...REMINDER_SAMPLE_DATA, company_name: companyName || REMINDER_SAMPLE_DATA.company_name };
  return Object.entries(data).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    text
  );
}

export default function CompanySetup() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [approvalPhoneError, setApprovalPhoneError] = useState(null);
  const [storedApprovalPhoneInvalid, setStoredApprovalPhoneInvalid] = useState(false);
  const [companyPhoneError, setCompanyPhoneError] = useState(null);
  // `uploading` state is replaced by useMutation's `isPending` status.
  const [companyData, _setCompanyData] = useState({
    company_name: "",
    company_tagline: "",
    logo_url: "",
    lexi_avatar_url: "", // New field for Lexi AI Avatar
    website: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    industry: "roofing",
    brand_primary_color: "#3b82f6",
    brand_secondary_color: "#8b5cf6",
    time_zone: "America/New_York",
    default_tax_rate: 0,
    invoice_prefix: "INV-",
    invoice_next_number: 1,
    estimate_prefix: "EST-",
    estimate_next_number: 1,
    customer_prefix: "",
    customer_next_number: 1,
    booking_form_config: {
      show_property_address: false,
      show_email: true,
      show_message: true,
      property_address_required: false,
      heading: "",
      confirmation_message: "",
      service_types: [],
    },
    default_estimate_notes: "",
    default_estimate_disclaimer: "",
    default_invoice_notes: "",
    default_invoice_disclaimer: "",
    default_proposal_notes: "",
    default_proposal_disclaimer: "",
    preferred_language: "en",
    approval_alert_phone: "",
    adjuster_review_notify_email: true,
    adjuster_review_notify_sms: true,
    adjuster_review_notify_email_override: "",
    voice_cheat_sheet: {
      photos: ['take photo', 'photo now', 'snap photo', 'capture now'],
      sections: ['front slope', 'rear elevation', 'right slope', 'left elevation', 'gutters', 'siding', 'interior'],
      counters: ['add two pipe boots', 'another vent', 'another chimney'],
    },
    preferred_shingle_brands: [],
  });
  const isDirty = useRef(false);
  const autoDocumentDefaults = useRef({});
  const documentDefaultsTouched = useRef(new Set());
  // Wrap the setter so every user edit marks the form dirty — background myCompany
  // refetches will then leave unsaved changes alone (see load useEffect below).
  const setCompanyData = useCallback((val) => {
    isDirty.current = true;
    _setCompanyData(val);
  }, []);
  const updateDocumentDefault = useCallback((field, value) => {
    documentDefaultsTouched.current.add(field);
    setCompanyData({ ...companyData, [field]: value });
  }, [companyData, setCompanyData]);

  const [newVoiceCmd, setNewVoiceCmd] = useState({ photos: '', sections: '', counters: '' });

  const [emailTemplateData, setEmailTemplateData] = useState({
    subject: '🔧 New Work Assignment: {property_address}',
    body: '',
  });
  const [smsTemplateData, setSmsTemplateData] = useState({
    message: '📸 New PhotoSync Assignment — {company_name}\n\n👤 {client_name}\n📍 {property_address}\n📞 {client_phone}\n📅 {scheduled_date}\n\nTap to start taking photos:\n{crewcam_link}',
  });
  const [reminderEmailTemplateData, setReminderEmailTemplateData] = useState({
    subject: '🔁 Reminder: Your PhotoSync link for {property_address}',
    body: '',
  });
  const [reminderSmsTemplateData, setReminderSmsTemplateData] = useState({
    message: '🔁 Reminder from {company_name}: here\'s your PhotoSync link again for {property_address} on {scheduled_date}.\n\n{crewcam_link}',
  });
  const [clientEmailTemplateData, setClientEmailTemplateData] = useState({
    subject: '🏠 Property Inspection Scheduled - {property_address}',
    body: '',
  });
  const [showAssignmentDefaultPreview, setShowAssignmentDefaultPreview] = useState(false);
  const [showReminderDefaultPreview, setShowReminderDefaultPreview] = useState(false);
  const [showClientDefaultPreview, setShowClientDefaultPreview] = useState(false);
  const [clientSmsTemplateData, setClientSmsTemplateData] = useState({
    message: '✅ Inspection confirmed for {scheduled_date} at {property_address}. Your inspector {inspector_name} will contact you soon at {inspector_phone}. - {company_name}',
  });
  const [homeownerPhotoSmsTemplateData, setHomeownerPhotoSmsTemplateData] = useState({
    message: '{name} uploaded a photo for [{addr}]. Review: {link}',
  });
  const [homeownerPhotoEmailTemplateData, setHomeownerPhotoEmailTemplateData] = useState({
    subject: '📸 New Photo Uploaded: {addr}',
    body: '',
  });
  const [testEmailStatus, setTestEmailStatus] = useState(null); // null | 'sending' | 'success' | 'error' | 'not_configured'
  const [testEmailError, setTestEmailError] = useState('');
  const [testEmailMessageId, setTestEmailMessageId] = useState('');
  const [testEmailProvider, setTestEmailProvider] = useState('');
  const [testSmsStatus, setTestSmsStatus] = useState(null); // null | 'sending' | 'success' | 'error' | 'not_configured'
  const [testSmsError, setTestSmsError] = useState('');
  const [testAssignmentSmsStatus, setTestAssignmentSmsStatus] = useState(null);
  const [testAssignmentSmsError, setTestAssignmentSmsError] = useState('');
  const [testReminderSmsStatus, setTestReminderSmsStatus] = useState(null);
  const [testReminderSmsError, setTestReminderSmsError] = useState('');
  const [testClientSmsStatus, setTestClientSmsStatus] = useState(null);
  const [testClientSmsError, setTestClientSmsError] = useState('');

  const [quickCreateShortcuts, setQuickCreateShortcuts] = useState([]); // [{id, color}]
  const [shortcutsSaved, setShortcutsSaved] = useState(false);

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
  });

  const myCompany = React.useMemo(() => {
    if (!user) return null;

    // Priority 1: Check for impersonated company
    const impersonatedId = sessionStorage.getItem('impersonating_company_id');
    if (impersonatedId) {
      const impersonated = companies.find(c => c.id === impersonatedId);
      if (impersonated) return impersonated;
    }

    // Priority 2: Check staff profile for company association
    const staffProfile = staffProfiles[0];
    if (staffProfile?.company_id) {
      const staffCompany = companies.find(c => c.id === staffProfile.company_id);
      if (staffCompany) return staffCompany;
    }
    
    // Priority 3: Check if user owns a company
    const ownedCompany = companies.find(c => c.created_by === user.email);
    if (ownedCompany) return ownedCompany;
    
    return null;
  }, [user, companies, staffProfiles]);

  const isAdmin = React.useMemo(() => {
    if (!user || !myCompany) return false;
    if (myCompany.created_by === user.email) return true;
    const sp = staffProfiles[0];
    return sp?.is_administrator === true || sp?.role === 'owner' || user?.is_super_admin === true;
  }, [user, myCompany, staffProfiles]);

  const { data: inspectorEmailTemplates = [] } = useQuery({
    queryKey: ['inspector-email-template', myCompany?.id],
    queryFn: () => myCompany
      ? base44.entities.EmailTemplate.filter({ company_id: myCompany.id, category: 'general', is_active: true })
      : [],
    enabled: !!myCompany,
  });

  const { data: inspectorSmsTemplates = [] } = useQuery({
    queryKey: ['inspector-sms-template', myCompany?.id],
    queryFn: () => myCompany
      ? base44.entities.SMSTemplate.filter({ company_id: myCompany.id, is_active: true })
      : [],
    enabled: !!myCompany,
  });

  useEffect(() => {
    const emailTpl = inspectorEmailTemplates.find(t => t.template_name === 'Inspector Assignment');
    if (emailTpl) {
      setEmailTemplateData({
        subject: emailTpl.subject || '🔧 New Work Assignment: {property_address}',
        body: emailTpl.body || '',
      });
    } else {
      setEmailTemplateData({
        subject: '🔧 New Work Assignment: {property_address}',
        body: '',
      });
    }
  }, [inspectorEmailTemplates]);

  useEffect(() => {
    const smsTpl = inspectorSmsTemplates.find(t => t.template_name === 'Inspector Assignment');
    if (smsTpl) {
      setSmsTemplateData({
        message: smsTpl.message || '📸 New PhotoSync Assignment — {company_name}\n\n👤 {client_name}\n📍 {property_address}\n📞 {client_phone}\n📅 {scheduled_date}\n\nTap to start taking photos:\n{crewcam_link}',
      });
    } else {
      setSmsTemplateData({
        message: '📸 New PhotoSync Assignment — {company_name}\n\n👤 {client_name}\n📍 {property_address}\n📞 {client_phone}\n📅 {scheduled_date}\n\nTap to start taking photos:\n{crewcam_link}',
      });
    }
  }, [inspectorSmsTemplates]);

  useEffect(() => {
    const tpl = inspectorEmailTemplates.find(t => t.template_name === 'Inspector Resend Reminder');
    if (tpl) {
      setReminderEmailTemplateData({
        subject: tpl.subject || '🔁 Reminder: Your PhotoSync link for {property_address}',
        body: tpl.body || '',
      });
    } else {
      setReminderEmailTemplateData({
        subject: '🔁 Reminder: Your PhotoSync link for {property_address}',
        body: '',
      });
    }
  }, [inspectorEmailTemplates]);

  useEffect(() => {
    const tpl = inspectorSmsTemplates.find(t => t.template_name === 'Inspector Resend Reminder');
    if (tpl) {
      setReminderSmsTemplateData({
        message: tpl.message || '🔁 Reminder from {company_name}: here\'s your PhotoSync link again for {property_address} on {scheduled_date}.\n\n{crewcam_link}',
      });
    } else {
      setReminderSmsTemplateData({
        message: '🔁 Reminder from {company_name}: here\'s your PhotoSync link again for {property_address} on {scheduled_date}.\n\n{crewcam_link}',
      });
    }
  }, [inspectorSmsTemplates]);

  useEffect(() => {
    const tpl = inspectorEmailTemplates.find(t => t.template_name === 'Client - Inspection Confirmation');
    if (tpl) {
      setClientEmailTemplateData({
        subject: tpl.subject || '🏠 Property Inspection Scheduled - {property_address}',
        body: tpl.body || '',
      });
    } else {
      setClientEmailTemplateData({
        subject: '🏠 Property Inspection Scheduled - {property_address}',
        body: '',
      });
    }
  }, [inspectorEmailTemplates]);

  useEffect(() => {
    const tpl = inspectorSmsTemplates.find(t => t.template_name === 'Client - Inspection Confirmation');
    if (tpl) {
      setClientSmsTemplateData({
        message: tpl.message || '✅ Inspection confirmed for {scheduled_date} at {property_address}. Your inspector {inspector_name} will contact you soon at {inspector_phone}. - {company_name}',
      });
    } else {
      setClientSmsTemplateData({
        message: '✅ Inspection confirmed for {scheduled_date} at {property_address}. Your inspector {inspector_name} will contact you soon at {inspector_phone}. - {company_name}',
      });
    }
  }, [inspectorSmsTemplates]);

  useEffect(() => {
    const tpl = inspectorSmsTemplates.find(t => t.template_name === 'Homeowner Photo Upload');
    if (tpl) {
      setHomeownerPhotoSmsTemplateData({ message: tpl.message || '{name} uploaded a photo for [{addr}]. Review: {link}' });
    } else {
      setHomeownerPhotoSmsTemplateData({ message: '{name} uploaded a photo for [{addr}]. Review: {link}' });
    }
  }, [inspectorSmsTemplates]);

  useEffect(() => {
    const tpl = inspectorEmailTemplates.find(t => t.template_name === 'Homeowner Photo Upload');
    if (tpl) {
      setHomeownerPhotoEmailTemplateData({
        subject: tpl.subject || '📸 New Photo Uploaded: {addr}',
        body: tpl.body || '',
      });
    } else {
      setHomeownerPhotoEmailTemplateData({ subject: '📸 New Photo Uploaded: {addr}', body: '' });
    }
  }, [inspectorEmailTemplates]);

  useEffect(() => {
    if (myCompany && !isDirty.current) {
      const generatedDocumentDefaults = buildDocumentDefaults(myCompany);
      autoDocumentDefaults.current = {};
      documentDefaultsTouched.current = new Set();
      const loadDocumentDefault = (field) => {
        const existingValue = String(myCompany[field] || '');
        if (existingValue) return existingValue;
        autoDocumentDefaults.current[field] = generatedDocumentDefaults[field];
        return generatedDocumentDefaults[field];
      };

      console.log('📋 Loading company data into form:', {
        id: myCompany.id,
        name: myCompany.company_name,
        email: myCompany.email,
        phone: myCompany.phone,
        settings: myCompany.settings
      });
      
      _setCompanyData({
        company_name: myCompany.company_name || "",
        company_tagline: myCompany.company_tagline || "",
        logo_url: myCompany.logo_url || "",
        lexi_avatar_url: myCompany.lexi_avatar_url || "", // Initialize Lexi Avatar URL
        website: myCompany.website || "",
        phone: myCompany.phone || "",
        email: myCompany.email || "",
        address: myCompany.address || "",
        city: myCompany.city || "",
        state: myCompany.state || "",
        zip: myCompany.zip || "",
        industry: myCompany.industry || "roofing",
        brand_primary_color: myCompany.brand_primary_color || "#3b82f6",
        brand_secondary_color: myCompany.brand_secondary_color || "#8b5cf6",
        time_zone: myCompany.settings?.time_zone || myCompany.settings?.timezone || myCompany.timezone || "America/New_York",
        default_tax_rate: myCompany.settings?.default_tax_rate ?? 0,
        invoice_prefix: myCompany.settings?.invoice_prefix || "INV-",
        invoice_next_number: myCompany.settings?.invoice_next_number ?? 1,
        estimate_prefix: myCompany.settings?.estimate_prefix || "EST-",
        estimate_next_number: myCompany.settings?.estimate_next_number ?? 1,
        customer_prefix: myCompany.settings?.customer_prefix ?? "",
        customer_next_number: myCompany.settings?.customer_next_number ?? 1,
        booking_form_config: {
          show_property_address: myCompany.booking_form_config?.show_property_address ?? false,
          show_email: myCompany.booking_form_config?.show_email ?? true,
          show_message: myCompany.booking_form_config?.show_message ?? true,
          property_address_required: myCompany.booking_form_config?.property_address_required ?? false,
          heading: myCompany.booking_form_config?.heading || "",
          confirmation_message: myCompany.booking_form_config?.confirmation_message || "",
          service_types: myCompany.booking_form_config?.service_types || [],
        },
        default_estimate_notes: loadDocumentDefault('default_estimate_notes'),
        default_estimate_disclaimer: loadDocumentDefault('default_estimate_disclaimer'),
        default_invoice_notes: loadDocumentDefault('default_invoice_notes'),
        default_invoice_disclaimer: loadDocumentDefault('default_invoice_disclaimer'),
        default_proposal_notes: loadDocumentDefault('default_proposal_notes'),
        default_proposal_disclaimer: loadDocumentDefault('default_proposal_disclaimer'),
        preferred_language: myCompany.preferred_language || "en",
        approval_alert_phone: myCompany.settings?.approval_alert_phone || "",
        adjuster_review_notify_email: myCompany.settings?.adjuster_review_notify_email !== false,
        adjuster_review_notify_sms: myCompany.settings?.adjuster_review_notify_sms !== false,
        adjuster_review_notify_email_override: myCompany.settings?.adjuster_review_notify_email_override || "",
        voice_cheat_sheet: myCompany.settings?.voice_cheat_sheet || {
          photos: ['take photo', 'photo now', 'snap photo', 'capture now'],
          sections: ['front slope', 'rear elevation', 'right slope', 'left elevation', 'gutters', 'siding', 'interior'],
          counters: ['add two pipe boots', 'another vent', 'another chimney'],
        },
        preferred_shingle_brands: myCompany.preferred_shingle_brands || [],
      });
      const storedPhone = myCompany.settings?.approval_alert_phone || "";
      const phoneErr = validateE164Phone(storedPhone);
      if (phoneErr && storedPhone) {
        setStoredApprovalPhoneInvalid(true);
        setApprovalPhoneError(phoneErr);
      } else {
        setStoredApprovalPhoneInvalid(false);
        setApprovalPhoneError(null);
      }
      setQuickCreateShortcuts(
        (myCompany.settings?.quick_create_shortcuts || []).map((item) =>
          typeof item === 'string' ? { id: item, color: null } : { id: item.id, color: item.color || null }
        )
      );
    } else {
      console.log('⚠️ No company found - using placeholder values');
    }
  }, [myCompany]);

  const saveCompanyMutation = useMutation({
    mutationFn: async (data) => {
      // Extract settings fields from the main data object
      const { 
        time_zone, 
        default_tax_rate,
        invoice_prefix,
        invoice_next_number,
        estimate_prefix,
        estimate_next_number,
        customer_prefix,
        customer_next_number,
        booking_form_config,
        default_estimate_notes,
        default_estimate_disclaimer,
        default_invoice_notes,
        default_invoice_disclaimer,
        default_proposal_notes,
        default_proposal_disclaimer,
        preferred_language,
        approval_alert_phone,
        adjuster_review_notify_email,
        adjuster_review_notify_sms,
        adjuster_review_notify_email_override,
        voice_cheat_sheet,
        ...restOfCompanyData 
      } = data;

      const settingsPayload = {
        ...(myCompany?.settings || {}), // Preserve existing settings
        time_zone,
        default_tax_rate,
        invoice_prefix,
        invoice_next_number,
        estimate_prefix,
        estimate_next_number,
        customer_prefix,
        customer_next_number,
        approval_alert_phone,
        adjuster_review_notify_email,
        adjuster_review_notify_sms,
        adjuster_review_notify_email_override: adjuster_review_notify_email_override || null,
        voice_cheat_sheet,
      };

      const finalPayload = {
        ...restOfCompanyData,
        timezone: time_zone || 'America/New_York',
        settings: settingsPayload,
        booking_form_config: booking_form_config,
        default_estimate_notes,
        default_estimate_disclaimer,
        default_invoice_notes,
        default_invoice_disclaimer,
        default_proposal_notes,
        default_proposal_disclaimer,
        preferred_language: preferred_language || 'en',
      };

      if (myCompany) {
        return base44.entities.Company.update(myCompany.id, finalPayload);
      } else {
        throw new Error('Complete Quick Setup before editing company settings.');
      }
    },
    onSuccess: (_, variables) => {
      isDirty.current = false;
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['translation-company'] });
      const savedLang = variables?.preferred_language || companyData.preferred_language || 'en';
      try {
        localStorage.setItem('crewcam_language', savedLang);
        window.dispatchEvent(new StorageEvent('storage', { key: 'crewcam_language', newValue: savedLang }));
      } catch {}
      alert("✅ Company profile saved successfully!");
    },
    onError: (error) => {
      console.error('❌ Save error:', error);
      alert("Failed to save: " + error.message);
    },
  });

  const saveShortcutsMutation = useMutation({
    mutationFn: (shortcuts) => {
      if (!isAdmin) throw new Error('Only company admins can change shortcuts.');
      return base44.entities.Company.update(myCompany.id, {
        settings: { ...(myCompany?.settings || {}), quick_create_shortcuts: shortcuts },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['layout-companies-list'] });
      setShortcutsSaved(true);
      setTimeout(() => setShortcutsSaved(false), 2000);
    },
    onError: (error) => {
      alert("Failed to save shortcuts: " + error.message);
    },
  });

  const handleShortcutToggle = (id) => {
    setQuickCreateShortcuts((prev) => {
      if (prev.some((s) => s.id === id)) return prev.filter((s) => s.id !== id);
      if (prev.length >= 10) return prev;
      return [...prev, { id, color: null }];
    });
  };

  const handleShortcutMoveUp = (idx) => {
    if (idx === 0) return;
    setQuickCreateShortcuts((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const handleShortcutMoveDown = (idx) => {
    setQuickCreateShortcuts((prev) => {
      if (idx === prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const uploadLogoMutation = useMutation({
    mutationFn: async (file) => {
      const response = await base44.integrations.Core.UploadFile({ file });
      return response.file_url;
    },
  });

  const uploadLexiAvatarMutation = useMutation({
    mutationFn: async (file) => {
      const response = await base44.integrations.Core.UploadFile({ file });
      return response.file_url;
    },
  });

  const saveEmailTemplateMutation = useMutation({
    mutationFn: (data) => {
      const existing = inspectorEmailTemplates.find(t => t.template_name === 'Inspector Assignment');
      if (existing) {
        return base44.entities.EmailTemplate.update(existing.id, data);
      } else {
        return base44.entities.EmailTemplate.create({
          ...data,
          template_name: 'Inspector Assignment',
          category: 'general',
          is_active: true,
          company_id: myCompany.id,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspector-email-template'] });
      alert('✅ Email template saved!');
    },
    onError: (error) => {
      alert('Failed to save email template: ' + error.message);
    },
  });

  const saveSmsTemplateMutation = useMutation({
    mutationFn: (data) => {
      const existing = inspectorSmsTemplates.find(t => t.template_name === 'Inspector Assignment');
      if (existing) {
        return base44.entities.SMSTemplate.update(existing.id, data);
      } else {
        return base44.entities.SMSTemplate.create({
          ...data,
          template_name: 'Inspector Assignment',
          category: 'general',
          is_active: true,
          company_id: myCompany.id,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspector-sms-template'] });
      alert('✅ SMS template saved!');
    },
    onError: (error) => {
      alert('Failed to save SMS template: ' + error.message);
    },
  });

  const saveReminderEmailTemplateMutation = useMutation({
    mutationFn: (data) => {
      const existing = inspectorEmailTemplates.find(t => t.template_name === 'Inspector Resend Reminder');
      if (existing) {
        return base44.entities.EmailTemplate.update(existing.id, data);
      } else {
        return base44.entities.EmailTemplate.create({
          ...data,
          template_name: 'Inspector Resend Reminder',
          category: 'general',
          is_active: true,
          company_id: myCompany.id,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspector-email-template'] });
      alert('✅ Resend reminder email template saved!');
    },
    onError: (error) => {
      alert('Failed to save resend reminder email template: ' + error.message);
    },
  });

  const saveReminderSmsTemplateMutation = useMutation({
    mutationFn: (data) => {
      const existing = inspectorSmsTemplates.find(t => t.template_name === 'Inspector Resend Reminder');
      if (existing) {
        return base44.entities.SMSTemplate.update(existing.id, data);
      } else {
        return base44.entities.SMSTemplate.create({
          ...data,
          template_name: 'Inspector Resend Reminder',
          category: 'general',
          is_active: true,
          company_id: myCompany.id,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspector-sms-template'] });
      alert('✅ Resend reminder SMS template saved!');
    },
    onError: (error) => {
      alert('Failed to save resend reminder SMS template: ' + error.message);
    },
  });

  const saveClientEmailTemplateMutation = useMutation({
    mutationFn: (data) => {
      const existing = inspectorEmailTemplates.find(t => t.template_name === 'Client - Inspection Confirmation');
      if (existing) {
        return base44.entities.EmailTemplate.update(existing.id, data);
      } else {
        return base44.entities.EmailTemplate.create({
          ...data,
          template_name: 'Client - Inspection Confirmation',
          category: 'general',
          is_active: true,
          company_id: myCompany.id,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspector-email-template'] });
      alert('✅ Client confirmation email template saved!');
    },
    onError: (error) => {
      alert('Failed to save client confirmation email template: ' + error.message);
    },
  });

  const saveClientSmsTemplateMutation = useMutation({
    mutationFn: (data) => {
      const existing = inspectorSmsTemplates.find(t => t.template_name === 'Client - Inspection Confirmation');
      if (existing) {
        return base44.entities.SMSTemplate.update(existing.id, data);
      } else {
        return base44.entities.SMSTemplate.create({
          ...data,
          template_name: 'Client - Inspection Confirmation',
          category: 'general',
          is_active: true,
          company_id: myCompany.id,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspector-sms-template'] });
      alert('✅ Client confirmation SMS template saved!');
    },
    onError: (error) => {
      alert('Failed to save client confirmation SMS template: ' + error.message);
    },
  });

  const saveHomeownerPhotoSmsTemplateMutation = useMutation({
    mutationFn: (data) => {
      const existing = inspectorSmsTemplates.find(t => t.template_name === 'Homeowner Photo Upload');
      if (existing) {
        return base44.entities.SMSTemplate.update(existing.id, data);
      } else {
        return base44.entities.SMSTemplate.create({
          ...data,
          template_name: 'Homeowner Photo Upload',
          category: 'general',
          is_active: true,
          company_id: myCompany.id,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspector-sms-template'] });
      alert('✅ Homeowner photo SMS template saved!');
    },
    onError: (error) => {
      alert('Failed to save homeowner photo SMS template: ' + error.message);
    },
  });

  const saveHomeownerPhotoEmailTemplateMutation = useMutation({
    mutationFn: (data) => {
      const existing = inspectorEmailTemplates.find(t => t.template_name === 'Homeowner Photo Upload');
      if (existing) {
        return base44.entities.EmailTemplate.update(existing.id, data);
      } else {
        return base44.entities.EmailTemplate.create({
          ...data,
          template_name: 'Homeowner Photo Upload',
          category: 'general',
          is_active: true,
          company_id: myCompany.id,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspector-email-template'] });
      alert('✅ Homeowner photo email template saved!');
    },
    onError: (error) => {
      alert('Failed to save homeowner photo email template: ' + error.message);
    },
  });

  const sendTestHomeownerEmail = async () => {
    if (!isAdmin || !user?.email || !myCompany?.id) return;
    const SAMPLE_NAME = 'Jane Smith';
    const SAMPLE_ADDR = '123 Maple St, Springfield, IL';
    const SAMPLE_LINK = 'https://getcompanysync.com/projects/preview?tab=photos';

    // Default subject and body match what production sends when no custom template is saved
    // (notifyPhotoRecipient in prod-server.cjs — kept in sync with that function)
    let subject = `📸 New Photo Uploaded: ${SAMPLE_ADDR}`;
    if (homeownerPhotoEmailTemplateData.subject && homeownerPhotoEmailTemplateData.subject.trim()) {
      subject = homeownerPhotoEmailTemplateData.subject
        .replaceAll('{name}', SAMPLE_NAME)
        .replaceAll('{addr}', SAMPLE_ADDR)
        .replaceAll('{link}', SAMPLE_LINK);
    }

    const brandColor = companyData.brand_primary_color || '#2563eb';
    let html = `<div style="font-family:Arial,sans-serif;color:#333"><h2 style="color:${brandColor}">New Homeowner Photo Upload</h2><p><strong>${SAMPLE_NAME}</strong> uploaded a photo for the project at <strong>${SAMPLE_ADDR}</strong>.</p><p>The photo is pending your review.</p><p style="margin-top:20px"><a href="${SAMPLE_LINK}" style="background:${brandColor};color:white;padding:10px 20px;border-radius:4px;text-decoration:none">Review Photo</a></p></div>`;
    if (homeownerPhotoEmailTemplateData.body && homeownerPhotoEmailTemplateData.body.trim()) {
      html = homeownerPhotoEmailTemplateData.body
        .replaceAll('{name}', SAMPLE_NAME)
        .replaceAll('{addr}', SAMPLE_ADDR)
        .replaceAll('{link}', SAMPLE_LINK);
    }

    setTestEmailStatus('sending');
    setTestEmailError('');
    setTestEmailMessageId('');
    setTestEmailProvider('');
    try {
      const result = await base44.functions.invoke('sendTestEmail', {
        subject,
        html,
        companyId: myCompany.id,
      });
      const response = result?.data || {};
      const errMsg = result?.error || response?.error || '';
      if (errMsg) {
        setTestEmailStatus(isEmailConfigError(errMsg) ? 'not_configured' : 'error');
        setTestEmailError(errMsg);
        window.dispatchEvent(new CustomEvent('email-provider-health-changed'));
      } else if (response.success && response.id) {
        setTestEmailStatus('success');
        setTestEmailMessageId(response.id);
        setTestEmailProvider(response.provider || 'email provider');
        window.dispatchEvent(new CustomEvent('email-provider-health-changed'));
      } else {
        setTestEmailStatus('error');
        setTestEmailError('The email provider did not return a Message ID, so delivery could not be confirmed.');
        window.dispatchEvent(new CustomEvent('email-provider-health-changed'));
      }
    } catch (err) {
      const msg = err?.message || String(err) || 'Unknown error';
      setTestEmailStatus(isEmailConfigError(msg) ? 'not_configured' : 'error');
      setTestEmailError(msg);
      window.dispatchEvent(new CustomEvent('email-provider-health-changed'));
    }
  };

  const sendTestHomeownerSms = async () => {
    if (!myCompany?.id) return;
    const toPhone = companyData.phone || myCompany?.phone;
    if (!toPhone) {
      setTestSmsStatus('error');
      setTestSmsError('No phone number found on your company profile. Add a phone number in the Company Info section above first.');
      return;
    }
    const SAMPLE_NAME = 'Jane Smith';
    const SAMPLE_ADDR = '123 Maple St, Springfield, IL';
    const SAMPLE_LINK = 'https://getcompanysync.com/projects/preview?tab=photos';
    let message = homeownerPhotoSmsTemplateData.message?.trim()
      ? homeownerPhotoSmsTemplateData.message
          .replaceAll('{name}', SAMPLE_NAME)
          .replaceAll('{addr}', SAMPLE_ADDR)
          .replaceAll('{link}', SAMPLE_LINK)
      : `${SAMPLE_NAME} uploaded a photo for [${SAMPLE_ADDR}]. Review: ${SAMPLE_LINK}`;

    setTestSmsStatus('sending');
    setTestSmsError('');
    try {
      const result = await base44.functions.invoke('sendSMS', {
        to: toPhone,
        message: `[TEST] ${message}`,
        companyId: myCompany.id,
        manualSend: true,
      });
      const errMsg = result?.error || '';
      if (errMsg) {
        setTestSmsStatus(isTwilioConfigError(errMsg) ? 'not_configured' : 'error');
        setTestSmsError(errMsg);
      } else {
        setTestSmsStatus('success');
        setTimeout(() => setTestSmsStatus(null), 4000);
      }
    } catch (err) {
      const msg = err?.message || String(err) || 'Unknown error';
      setTestSmsStatus(isTwilioConfigError(msg) ? 'not_configured' : 'error');
      setTestSmsError(msg);
    }
  };

  const sendTestAssignmentSms = async () => {
    if (!myCompany?.id) return;
    const toPhone = companyData.phone || myCompany?.phone;
    if (!toPhone) {
      setTestAssignmentSmsStatus('error');
      setTestAssignmentSmsError('No phone number found on your company profile. Add a phone number in the Company Info section above first.');
      return;
    }
    const message = smsTemplateData.message?.trim()
      ? applyReminderMergeFields(smsTemplateData.message, companyData.company_name || myCompany?.company_name)
      : applyReminderMergeFields('📸 New PhotoSync Assignment — {company_name}\n\n👤 {client_name}\n📍 {property_address}\n📞 {client_phone}\n📅 {scheduled_date}\n\nTap to start taking photos:\n{crewcam_link}', companyData.company_name || myCompany?.company_name);
    setTestAssignmentSmsStatus('sending');
    setTestAssignmentSmsError('');
    try {
      const result = await base44.functions.invoke('sendSMS', {
        to: toPhone,
        message: `[TEST] ${message}`,
        companyId: myCompany.id,
        manualSend: true,
      });
      const errMsg = result?.error || '';
      if (errMsg) {
        setTestAssignmentSmsStatus(isTwilioConfigError(errMsg) ? 'not_configured' : 'error');
        setTestAssignmentSmsError(errMsg);
      } else {
        setTestAssignmentSmsStatus('success');
        setTimeout(() => setTestAssignmentSmsStatus(null), 4000);
      }
    } catch (err) {
      const msg = err?.message || String(err) || 'Unknown error';
      setTestAssignmentSmsStatus(isTwilioConfigError(msg) ? 'not_configured' : 'error');
      setTestAssignmentSmsError(msg);
    }
  };

  const sendTestReminderSms = async () => {
    if (!myCompany?.id) return;
    const toPhone = companyData.phone || myCompany?.phone;
    if (!toPhone) {
      setTestReminderSmsStatus('error');
      setTestReminderSmsError('No phone number found on your company profile. Add a phone number in the Company Info section above first.');
      return;
    }
    const message = reminderSmsTemplateData.message?.trim()
      ? applyReminderMergeFields(reminderSmsTemplateData.message, companyData.company_name || myCompany?.company_name)
      : applyReminderMergeFields("🔁 Reminder from {company_name}: here's your PhotoSync link again for {property_address} on {scheduled_date}.\n\n{crewcam_link}", companyData.company_name || myCompany?.company_name);
    setTestReminderSmsStatus('sending');
    setTestReminderSmsError('');
    try {
      const result = await base44.functions.invoke('sendSMS', {
        to: toPhone,
        message: `[TEST] ${message}`,
        companyId: myCompany.id,
        manualSend: true,
      });
      const errMsg = result?.error || '';
      if (errMsg) {
        setTestReminderSmsStatus(isTwilioConfigError(errMsg) ? 'not_configured' : 'error');
        setTestReminderSmsError(errMsg);
      } else {
        setTestReminderSmsStatus('success');
        setTimeout(() => setTestReminderSmsStatus(null), 4000);
      }
    } catch (err) {
      const msg = err?.message || String(err) || 'Unknown error';
      setTestReminderSmsStatus(isTwilioConfigError(msg) ? 'not_configured' : 'error');
      setTestReminderSmsError(msg);
    }
  };

  const sendTestClientSms = async () => {
    if (!myCompany?.id) return;
    const toPhone = companyData.phone || myCompany?.phone;
    if (!toPhone) {
      setTestClientSmsStatus('error');
      setTestClientSmsError('No phone number found on your company profile. Add a phone number in the Company Info section above first.');
      return;
    }
    const message = clientSmsTemplateData.message?.trim()
      ? applyReminderMergeFields(clientSmsTemplateData.message, companyData.company_name || myCompany?.company_name)
      : applyReminderMergeFields('✅ Inspection confirmed for {scheduled_date} at {property_address}. Your inspector {inspector_name} will contact you soon at {inspector_phone}. - {company_name}', companyData.company_name || myCompany?.company_name);
    setTestClientSmsStatus('sending');
    setTestClientSmsError('');
    try {
      const result = await base44.functions.invoke('sendSMS', {
        to: toPhone,
        message: `[TEST] ${message}`,
        companyId: myCompany.id,
        manualSend: true,
      });
      const errMsg = result?.error || '';
      if (errMsg) {
        setTestClientSmsStatus(isTwilioConfigError(errMsg) ? 'not_configured' : 'error');
        setTestClientSmsError(errMsg);
      } else {
        setTestClientSmsStatus('success');
        setTimeout(() => setTestClientSmsStatus(null), 4000);
      }
    } catch (err) {
      const msg = err?.message || String(err) || 'Unknown error';
      setTestClientSmsStatus(isTwilioConfigError(msg) ? 'not_configured' : 'error');
      setTestClientSmsError(msg);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const url = await uploadLogoMutation.mutateAsync(file);
      setCompanyData({ ...companyData, logo_url: url });
    } catch (error) {
      alert('Failed to upload logo: ' + error.message);
    }
  };

  const handleLexiAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const url = await uploadLexiAvatarMutation.mutateAsync(file);
      setCompanyData({ ...companyData, lexi_avatar_url: url });
    } catch (error) {
      alert('Failed to upload Lexi avatar: ' + error.message);
    }
  };

  const handleSave = () => {
    if (!companyData.company_name || !companyData.email) {
      alert("Please fill in company name and email");
      return;
    }
    const phoneErr = validateE164Phone(companyData.phone);
    if (phoneErr) {
      setCompanyPhoneError(phoneErr);
      return;
    }
    setCompanyPhoneError(null);
    const approvalErr = validateE164Phone(companyData.approval_alert_phone);
    if (approvalErr) {
      setApprovalPhoneError(approvalErr);
      return;
    }
    setApprovalPhoneError(null);

    const generatedDocumentDefaults = buildDocumentDefaults(companyData);
    const dataToSave = { ...companyData };
    DOCUMENT_DEFAULT_FIELDS.forEach((field) => {
      const currentValue = String(companyData[field] || '');
      const wasGenerated = autoDocumentDefaults.current[field];
      const wasEdited = documentDefaultsTouched.current.has(field);

      // Keep generated text current as company details change, but never
      // overwrite a field the user has edited or intentionally cleared.
      if (!wasEdited && (!currentValue || currentValue === wasGenerated)) {
        dataToSave[field] = generatedDocumentDefaults[field];
        autoDocumentDefaults.current[field] = generatedDocumentDefaults[field];
      }
    });

    _setCompanyData(dataToSave);
    saveCompanyMutation.mutate(dataToSave);
  };

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg flex items-center justify-center">
          <Building2 className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Company Setup</h1>
          <p className="text-gray-500 mt-1">Configure your company profile and branding</p>
        </div>
      </div>

      {myCompany ? (
        <Alert className="bg-green-50 border-green-200">
          <AlertDescription>
            <strong>Company Found:</strong> {myCompany.company_name || 'Your Company'} (ID: {myCompany.id.slice(0, 12)}...)
            <br />
            Update your company profile below. Your existing data is pre-filled.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="bg-yellow-50 border-yellow-300">
          <AlertDescription>
            <strong>No Company Found:</strong> Creating a new company profile. If you already have company data, please check the Utilities page.
          </AlertDescription>
        </Alert>
      )}

      <Card className="bg-white shadow-md">
        <CardHeader className="border-b bg-gray-50">
          <CardTitle>Company Information</CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 space-y-6"> {/* Retain original padding/spacing */}

          {/* Company Name & Tagline */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label>Company Name *</Label>
              <Input
                value={companyData.company_name}
                onChange={(e) => setCompanyData({ ...companyData, company_name: e.target.value })}
                placeholder="ABC Roofing Company"
              />
            </div>

            <div className="md:col-span-2">
              <Label>Tagline</Label>
              <Input
                value={companyData.company_tagline}
                onChange={(e) => setCompanyData({ ...companyData, company_tagline: e.target.value })}
                placeholder="Quality Roofing Since 2010"
              />
            </div>
          </div>

          {/* Company Logo & Lexi AI Avatar */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Label>Company Logo</Label>
              <div className="mt-2 flex items-center gap-4">
                {companyData.logo_url && (
                  <img
                    src={companyData.logo_url}
                    alt="Logo"
                    className="w-20 h-20 object-contain border rounded"
                  />
                )}
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                    id="logo-upload"
                  />
                  <label htmlFor="logo-upload">
                    <Button type="button" variant="outline" asChild disabled={uploadLogoMutation.isPending}>
                      <span className="cursor-pointer">
                        <Upload className="w-4 h-4 mr-2" />
                        {uploadLogoMutation.isPending ? 'Uploading...' : 'Upload Logo'}
                      </span>
                    </Button>
                  </label>
                  <p className="text-xs text-gray-500 mt-2">PNG, JPG up to 5MB. Recommended size: 500x500px</p>
                </div>
              </div>
            </div>

            <div>
              <Label>Lexi AI Avatar</Label>
              <div className="mt-2 flex items-center gap-4">
                {companyData.lexi_avatar_url ? (
                  <img
                    src={companyData.lexi_avatar_url}
                    alt="Lexi Avatar"
                    className="w-20 h-20 rounded-full object-cover border-4 border-purple-200"
                  />
                ) : (
                  <img
                    src="https://api.dicebear.com/7.x/bottts/svg?seed=lexi&backgroundColor=b6e3f4"
                    alt="Default Lexi"
                    className="w-20 h-20 rounded-full object-cover border-4 border-gray-200"
                  />
                )}
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLexiAvatarUpload}
                    className="hidden"
                    id="lexi-avatar-upload"
                  />
                  <label htmlFor="lexi-avatar-upload">
                    <Button type="button" variant="outline" asChild disabled={uploadLexiAvatarMutation.isPending}>
                      <span className="cursor-pointer">
                        <Upload className="w-4 h-4 mr-2" />
                        {uploadLexiAvatarMutation.isPending ? 'Uploading...' : 'Upload Lexi Avatar'}
                      </span>
                    </Button>
                  </label>
                  <p className="text-xs text-gray-500 mt-2">Customize Lexi's appearance</p>
                </div>
              </div>
            </div>
          </div>

          {/* Remaining Company Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Label>{t.settings.industry}</Label>
              <Select value={companyData.industry} onValueChange={(v) => setCompanyData({ ...companyData, industry: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="roofing">Roofing</SelectItem>
                  <SelectItem value="construction">Construction</SelectItem>
                  <SelectItem value="hvac">HVAC</SelectItem>
                  <SelectItem value="plumbing">Plumbing</SelectItem>
                  <SelectItem value="electrical">Electrical</SelectItem>
                  <SelectItem value="general_contractor">General Contractor</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t.settings.timezone}</Label>
              <Select value={companyData.time_zone} onValueChange={(v) => setCompanyData({ ...companyData, time_zone: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timezones.map(tz => (
                    <SelectItem key={tz} value={tz}>{tz.replace('America/', '').replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="flex items-center gap-2">
                <Globe className="w-4 h-4" />
                {t.settings.preferredLanguage}
              </Label>
              <Select value={companyData.preferred_language} onValueChange={(v) => {
                setCompanyData({ ...companyData, preferred_language: v });
                try {
                  localStorage.setItem('crewcam_language', v);
                  window.dispatchEvent(new StorageEvent('storage', { key: 'crewcam_language', newValue: v }));
                } catch {}
              }}>
                <SelectTrigger data-testid="select-preferred-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t.settings.english}</SelectItem>
                  <SelectItem value="es">{t.settings.spanish}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">{t.settings.languageDescription}</p>
            </div>

            <div>
              <Label>{t.settings.website}</Label>
              <Input
                value={companyData.website}
                onChange={(e) => setCompanyData({ ...companyData, website: e.target.value })}
                placeholder="https://yourcompany.com"
              />
            </div>

            <div>
              <Label>{t.settings.email} *</Label>
              <Input
                type="email"
                value={companyData.email}
                onChange={(e) => setCompanyData({ ...companyData, email: e.target.value })}
                placeholder="info@yourcompany.com"
              />
            </div>

            <div>
              <Label>{t.settings.phone}</Label>
              <div className="flex gap-2">
                <Input
                  data-testid="input-company-phone"
                  value={companyData.phone}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCompanyData({ ...companyData, phone: val });
                    setCompanyPhoneError(validateE164Phone(val));
                  }}
                  placeholder="+15551234567"
                  className={`flex-1 ${companyPhoneError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                />
                {looksLikeFormattableUSPhone(companyData.phone) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="button-format-company-phone"
                    onClick={() => {
                      const formatted = formatToE164(companyData.phone);
                      if (formatted) {
                        setCompanyData({ ...companyData, phone: formatted });
                        setCompanyPhoneError(validateE164Phone(formatted));
                      }
                    }}
                  >
                    Format
                  </Button>
                )}
              </div>
              {companyPhoneError ? (
                <p data-testid="error-company-phone" className="text-xs text-red-600 mt-1">{companyPhoneError}</p>
              ) : (
                <p className="text-xs text-gray-500 mt-1">Use E.164 format (e.g. +15551234567) — must start with + and country code.</p>
              )}
            </div>

            <div className="md:col-span-2">
              <Label>{t.settings.address}</Label>
              <Input
                value={companyData.address}
                onChange={(e) => setCompanyData({ ...companyData, address: e.target.value })}
                placeholder="123 Main Street"
              />
            </div>

            <div>
              <Label>{t.settings.city}</Label>
              <Input
                value={companyData.city}
                onChange={(e) => setCompanyData({ ...companyData, city: e.target.value })}
                placeholder="Dallas"
              />
            </div>

            <div>
              <Label>{t.settings.state}</Label>
              <Input
                value={companyData.state}
                onChange={(e) => setCompanyData({ ...companyData, state: e.target.value })}
                placeholder="TX"
                maxLength={2}
              />
            </div>

            <div>
              <Label>{t.settings.zip}</Label>
              <Input
                value={companyData.zip}
                onChange={(e) => setCompanyData({ ...companyData, zip: e.target.value })}
                placeholder="75201"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white shadow-md">
        <CardHeader className="border-b bg-gray-50">
          <CardTitle>Brand Colors</CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Label>Primary Brand Color</Label>
              <div className="flex items-center gap-3">
                <Input
                  type="color"
                  value={companyData.brand_primary_color}
                  onChange={(e) => setCompanyData({ ...companyData, brand_primary_color: e.target.value })}
                  className="w-20 h-10"
                />
                <Input
                  value={companyData.brand_primary_color}
                  onChange={(e) => setCompanyData({ ...companyData, brand_primary_color: e.target.value })}
                  placeholder="#3b82f6"
                  className="flex-1"
                />
              </div>
            </div>

            <div>
              <Label>Secondary Brand Color</Label>
              <div className="flex items-center gap-3">
                <Input
                  type="color"
                  value={companyData.brand_secondary_color}
                  onChange={(e) => setCompanyData({ ...companyData, brand_secondary_color: e.target.value })}
                  className="w-20 h-10"
                />
                <Input
                  value={companyData.brand_secondary_color}
                  onChange={(e) => setCompanyData({ ...companyData, brand_secondary_color: e.target.value })}
                  placeholder="#8b5cf6"
                  className="flex-1"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white shadow-md">
        <CardHeader className="border-b bg-gray-50">
          <CardTitle className="flex items-center gap-2"><Package className="w-5 h-5 text-blue-600" /> Preferred Shingle Brands</CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-6">
          <p className="text-sm text-gray-500 mb-4">
            Choose which brands appear in the AI Measurement Report and arrange them in your preferred order. Uncheck a brand to hide it.
          </p>
          {(() => {
            const brands = companyData.preferred_shingle_brands;
            // When nothing is saved yet, treat all defaults as active in their default order
            const activeBrands = brands.length === 0 ? DEFAULT_BRANDS.map(b => ({ ...b })) : brands;
            const activeShorts = new Set(activeBrands.map(b => b.short));
            // Unchecked defaults: in DEFAULT_BRANDS but not currently active
            const uncheckedDefaults = brands.length === 0 ? [] : DEFAULT_BRANDS.filter(d => !activeShorts.has(d.short));

            const moveItem = (short, dir) => {
              const arr = brands.length === 0 ? DEFAULT_BRANDS.map(b => ({ ...b })) : [...brands];
              const idx = arr.findIndex(b => b.short === short);
              const target = idx + dir;
              if (target < 0 || target >= arr.length) return;
              [arr[idx], arr[target]] = [arr[target], arr[idx]];
              setCompanyData({ ...companyData, preferred_shingle_brands: arr });
            };

            const toggleBrand = (brand, checked) => {
              const current = brands.length === 0 ? DEFAULT_BRANDS.map(b => ({ ...b })) : [...brands];
              const next = checked
                ? current.some(b => b.short === brand.short) ? current : [...current, { ...brand }]
                : current.filter(b => b.short !== brand.short);
              setCompanyData({ ...companyData, preferred_shingle_brands: next });
            };

            const updateField = (short, field, value) => {
              const base = brands.length === 0 ? DEFAULT_BRANDS.map(b => ({ ...b })) : [...brands];
              const next = base.map(b => b.short === short ? { ...b, [field]: value } : b);
              setCompanyData({ ...companyData, preferred_shingle_brands: next });
            };

            return (
              <div className="space-y-2">
                {activeBrands.map((brand, i) => {
                  const def = DEFAULT_BRANDS.find(d => d.short === brand.short);
                  const isDefault = !!def;
                  const bPerSq = brand.bPerSq ?? def?.bPerSq ?? 3;
                  const product = brand.product ?? def?.product ?? '';
                  return (
                    <div key={brand.short} className={`flex items-center gap-2 p-3 border rounded-lg ${isDefault ? 'bg-gray-50' : 'bg-blue-50'}`}>
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <Button
                          variant="ghost" size="icon"
                          data-testid={`btn-move-up-brand-${brand.short}`}
                          className="h-5 w-5"
                          disabled={i === 0}
                          onClick={() => moveItem(brand.short, -1)}
                        >
                          <ChevronUp className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          data-testid={`btn-move-down-brand-${brand.short}`}
                          className="h-5 w-5"
                          disabled={i === activeBrands.length - 1}
                          onClick={() => moveItem(brand.short, 1)}
                        >
                          <ChevronDown className="w-3 h-3" />
                        </Button>
                      </div>
                      <Checkbox
                        data-testid={`checkbox-brand-${brand.short}`}
                        checked={true}
                        onCheckedChange={(checked) => toggleBrand(brand, !!checked)}
                      />
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <Label className="text-xs text-gray-500">Brand</Label>
                          <div className="font-semibold text-sm mt-0.5">{brand.short}</div>
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500">Product</Label>
                          <Input
                            data-testid={`input-brand-product-${brand.short}`}
                            value={product}
                            onChange={(e) => updateField(brand.short, 'product', e.target.value)}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500">Bundles / SQ</Label>
                          <Input
                            data-testid={`input-brand-bpersq-${brand.short}`}
                            type="number"
                            step="0.01"
                            min="1"
                            max="10"
                            value={bPerSq}
                            onChange={(e) => updateField(brand.short, 'bPerSq', parseFloat(e.target.value) || (def?.bPerSq ?? 3))}
                            className="h-7 text-xs"
                          />
                        </div>
                      </div>
                      {!isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`btn-remove-custom-brand-${brand.short}`}
                          onClick={() => setCompanyData({
                            ...companyData,
                            preferred_shingle_brands: brands.filter(b => b.short !== brand.short),
                          })}
                        >
                          <X className="w-4 h-4 text-red-500" />
                        </Button>
                      )}
                    </div>
                  );
                })}

                {uncheckedDefaults.map((brand) => (
                  <div key={brand.short} className="flex items-center gap-2 p-3 border rounded-lg bg-gray-50 opacity-60">
                    <div className="w-10 shrink-0" />
                    <Checkbox
                      data-testid={`checkbox-brand-${brand.short}`}
                      checked={false}
                      onCheckedChange={(checked) => toggleBrand(brand, !!checked)}
                    />
                    <div className="flex-1 flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-500">{brand.short}</span>
                      <span className="text-xs text-gray-400">hidden from report</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
          <div className="mt-4 border-t pt-4">
            <p className="text-xs font-semibold text-gray-600 mb-2">Add Custom Brand</p>
            <CustomBrandAdder
              existingShorts={(companyData.preferred_shingle_brands.length === 0 ? DEFAULT_BRANDS : companyData.preferred_shingle_brands).map(b => b.short)}
              onAdd={(newBrand) => {
                const base = companyData.preferred_shingle_brands.length === 0
                  ? DEFAULT_BRANDS.map(b => ({ ...b }))
                  : [...companyData.preferred_shingle_brands];
                if (!base.some(b => b.short.toLowerCase() === newBrand.short.toLowerCase())) {
                  setCompanyData({ ...companyData, preferred_shingle_brands: [...base, newBrand] });
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white shadow-md">
        <CardHeader className="border-b bg-gray-50">
          <CardTitle>Business Settings</CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 space-y-6">
          <div>
            <Label>{t.settings.defaultTaxRate} (%)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={companyData.default_tax_rate}
              onChange={(e) => setCompanyData({ ...companyData, default_tax_rate: parseFloat(e.target.value) || 0 })}
              placeholder="7.5"
            />
            <p className="text-xs text-gray-500 mt-1">Applied to invoices and estimates by default</p>
          </div>

          <div className="border-t pt-6">
            <h3 className="font-semibold mb-4">Numbering Formats</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>{t.settings.invoicePrefix}</Label>
                <Input
                  value={companyData.invoice_prefix}
                  onChange={(e) => setCompanyData({ ...companyData, invoice_prefix: e.target.value })}
                  placeholder="INV-"
                />
              </div>
              <div>
                <Label>Next Invoice Number</Label>
                <Input
                  type="number"
                  min="1"
                  value={companyData.invoice_next_number}
                  onChange={(e) => setCompanyData({ ...companyData, invoice_next_number: parseInt(e.target.value) || 1 })}
                />
              </div>

              <div>
                <Label>{t.settings.estimatePrefix}</Label>
                <Input
                  value={companyData.estimate_prefix}
                  onChange={(e) => setCompanyData({ ...companyData, estimate_prefix: e.target.value })}
                  placeholder="EST-"
                />
              </div>
              <div>
                <Label>Next Estimate Number</Label>
                <Input
                  type="number"
                  min="1"
                  value={companyData.estimate_next_number}
                  onChange={(e) => setCompanyData({ ...companyData, estimate_next_number: parseInt(e.target.value) || 1 })}
                />
              </div>

              <div>
                <Label>Customer Prefix (Optional)</Label>
                <Input
                  value={companyData.customer_prefix}
                  onChange={(e) => setCompanyData({ ...companyData, customer_prefix: e.target.value })}
                  placeholder="CUST-"
                />
              </div>
              <div>
                <Label>Next Customer Number</Label>
                <Input
                  type="number"
                  min="1"
                  value={companyData.customer_next_number}
                  onChange={(e) => setCompanyData({ ...companyData, customer_next_number: parseInt(e.target.value) || 1 })}
                />
              </div>
            </div>

            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Preview:</strong> Invoice: {companyData.invoice_prefix}{companyData.invoice_next_number} | 
                Estimate: {companyData.estimate_prefix}{companyData.estimate_next_number} | 
                Customer: {companyData.customer_prefix}{companyData.customer_next_number}
              </p>
            </div>
          </div>

          <div className="border-t pt-6">
            <h3 className="font-semibold mb-1">Alert Settings</h3>
            <p className="text-sm text-gray-500 mb-4">Configure where approval SMS alerts are sent when an estimate is ready for review.</p>
            {storedApprovalPhoneInvalid && (
              <div data-testid="warning-stored-approval-phone-invalid" className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <p className="text-sm text-amber-800">
                  The saved approval alert phone number is not in valid E.164 format and SMS alerts may fail.{" "}
                  <button
                    type="button"
                    data-testid="link-fix-approval-phone"
                    className="font-semibold underline hover:text-amber-900"
                    onClick={() => document.querySelector('[data-testid="input-approval-alert-phone"]')?.focus()}
                  >
                    Fix it below.
                  </button>
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>Approval Alert Phone Number</Label>
                <div className="flex gap-2">
                  <Input
                    data-testid="input-approval-alert-phone"
                    value={companyData.approval_alert_phone}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCompanyData({ ...companyData, approval_alert_phone: val });
                      const err = validateE164Phone(val);
                      setApprovalPhoneError(err);
                      if (!err) setStoredApprovalPhoneInvalid(false);
                    }}
                    placeholder="+15551234567"
                    className={`flex-1 ${approvalPhoneError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                  />
                  {looksLikeFormattableUSPhone(companyData.approval_alert_phone) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-testid="button-format-approval-alert-phone"
                      onClick={() => {
                        const formatted = formatToE164(companyData.approval_alert_phone);
                        if (formatted) {
                          setCompanyData({ ...companyData, approval_alert_phone: formatted });
                          const err = validateE164Phone(formatted);
                          setApprovalPhoneError(err);
                          if (!err) setStoredApprovalPhoneInvalid(false);
                        }
                      }}
                    >
                      Format
                    </Button>
                  )}
                </div>
                {approvalPhoneError ? (
                  <p data-testid="error-approval-alert-phone" className="text-xs text-red-600 mt-1">{approvalPhoneError}</p>
                ) : (
                  <p className="text-xs text-gray-500 mt-1">Use E.164 format (e.g. +15551234567). When set, approval SMS alerts are sent to this number instead of the owner's profile phone.</p>
                )}
              </div>
            </div>
          </div>

          <div className="border-t pt-6">
            <h3 className="font-semibold mb-1">Adjuster Review Notifications</h3>
            <p className="text-sm text-gray-500 mb-4">Choose how you want to be notified when an adjuster submits their line-item review.</p>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Email notification</p>
                  <p className="text-xs text-gray-500">Receive an email summary when an adjuster submits their review</p>
                </div>
                <Switch
                  data-testid="switch-adjuster-review-notify-email"
                  checked={companyData.adjuster_review_notify_email}
                  onCheckedChange={(checked) => setCompanyData({ ...companyData, adjuster_review_notify_email: checked })}
                />
              </div>

              {companyData.adjuster_review_notify_email && (
                <div className="ml-0 pl-0">
                  <Label>Notification Email (optional)</Label>
                  <Input
                    data-testid="input-adjuster-review-notify-email-override"
                    type="email"
                    value={companyData.adjuster_review_notify_email_override}
                    onChange={(e) => setCompanyData({ ...companyData, adjuster_review_notify_email_override: e.target.value })}
                    placeholder={companyData.email || "e.g. pm@yourcompany.com"}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    If set, adjuster review alerts go to this address instead of the company email. Useful for routing alerts to a project manager.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">SMS notification</p>
                  <p className="text-xs text-gray-500">Receive a text message when an adjuster submits their review</p>
                </div>
                <Switch
                  data-testid="switch-adjuster-review-notify-sms"
                  checked={companyData.adjuster_review_notify_sms}
                  onCheckedChange={(checked) => setCompanyData({ ...companyData, adjuster_review_notify_sms: checked })}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white shadow-md">
        <CardHeader className="border-b bg-gray-50">
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-blue-600" />
            <CardTitle>Booking Form Configuration</CardTitle>
          </div>
          <p className="text-sm text-gray-500 mt-1">Customize the public appointment booking page for your customers</p>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 space-y-6">

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Label>Custom Heading</Label>
              <Input
                value={companyData.booking_form_config.heading}
                onChange={(e) => setCompanyData({ ...companyData, booking_form_config: { ...companyData.booking_form_config, heading: e.target.value } })}
                placeholder="Schedule an Appointment"
              />
              <p className="text-xs text-gray-500 mt-1">Leave blank for default</p>
            </div>
            <div>
              <Label>Confirmation Message</Label>
              <Input
                value={companyData.booking_form_config.confirmation_message}
                onChange={(e) => setCompanyData({ ...companyData, booking_form_config: { ...companyData.booking_form_config, confirmation_message: e.target.value } })}
                placeholder="We'll confirm your appointment within 24 hours"
              />
              <p className="text-xs text-gray-500 mt-1">Shown after booking is submitted</p>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-medium text-sm text-gray-700">Field Visibility</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <Label>Show Email Field</Label>
                <Switch
                  checked={companyData.booking_form_config.show_email}
                  onCheckedChange={(v) => setCompanyData({ ...companyData, booking_form_config: { ...companyData.booking_form_config, show_email: v } })}
                />
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <Label>Show Message Field</Label>
                <Switch
                  checked={companyData.booking_form_config.show_message}
                  onCheckedChange={(v) => setCompanyData({ ...companyData, booking_form_config: { ...companyData.booking_form_config, show_message: v } })}
                />
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <Label>Show Property Address</Label>
                <Switch
                  checked={companyData.booking_form_config.show_property_address}
                  onCheckedChange={(v) => setCompanyData({ ...companyData, booking_form_config: { ...companyData.booking_form_config, show_property_address: v } })}
                />
              </div>
              {companyData.booking_form_config.show_property_address && (
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <Label>Property Address Required</Label>
                  <Switch
                    checked={companyData.booking_form_config.property_address_required}
                    onCheckedChange={(v) => setCompanyData({ ...companyData, booking_form_config: { ...companyData.booking_form_config, property_address_required: v } })}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4 border-t pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-sm text-gray-700">Service Type Options</h4>
                <p className="text-xs text-gray-500">Custom options for the "Service Type" dropdown</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const types = [...(companyData.booking_form_config.service_types || [])];
                  types.push({ value: "", label: "" });
                  setCompanyData({ ...companyData, booking_form_config: { ...companyData.booking_form_config, service_types: types } });
                }}
              >
                <Plus className="w-4 h-4 mr-1" /> Add Option
              </Button>
            </div>

            {(companyData.booking_form_config.service_types || []).length === 0 && (
              <p className="text-sm text-gray-400 italic">No custom service types — defaults will be used based on industry.</p>
            )}

            {(companyData.booking_form_config.service_types || []).map((st, i) => (
              <div key={i} className="flex items-center gap-3">
                <Input
                  placeholder="Value (e.g. roof_inspection)"
                  value={st.value}
                  onChange={(e) => {
                    const types = [...companyData.booking_form_config.service_types];
                    types[i] = { ...types[i], value: e.target.value };
                    setCompanyData({ ...companyData, booking_form_config: { ...companyData.booking_form_config, service_types: types } });
                  }}
                  className="flex-1"
                />
                <Input
                  placeholder="Label (e.g. Roofing Inspection)"
                  value={st.label}
                  onChange={(e) => {
                    const types = [...companyData.booking_form_config.service_types];
                    types[i] = { ...types[i], label: e.target.value };
                    setCompanyData({ ...companyData, booking_form_config: { ...companyData.booking_form_config, service_types: types } });
                  }}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    const types = companyData.booking_form_config.service_types.filter((_, idx) => idx !== i);
                    setCompanyData({ ...companyData, booking_form_config: { ...companyData.booking_form_config, service_types: types } });
                  }}
                >
                  <X className="w-4 h-4 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white shadow-md">
        <CardHeader className="border-b bg-gray-50">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-600" />
            <CardTitle>PhotoSync Assignment — Email & SMS Templates</CardTitle>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Customize the email and SMS messages sent to an inspector when they are assigned to a PhotoSync job.
            Use merge fields like <code className="bg-gray-100 px-1 rounded text-xs">{'{inspector_name}'}</code>,{' '}
            <code className="bg-gray-100 px-1 rounded text-xs">{'{property_address}'}</code>,{' '}
            <code className="bg-gray-100 px-1 rounded text-xs">{'{scheduled_date}'}</code>,{' '}
            <code className="bg-gray-100 px-1 rounded text-xs">{'{company_name}'}</code>, and{' '}
            <code className="bg-gray-100 px-1 rounded text-xs">{'{crewcam_link}'}</code> to personalize messages.
          </p>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 space-y-8">

          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Mail className="w-4 h-4 text-blue-600" /> Inspector Assignment Email
            </h3>
            <div>
              <Label htmlFor="email-subject">Subject Line</Label>
              <Input
                id="email-subject"
                data-testid="input-email-subject"
                value={emailTemplateData.subject}
                onChange={(e) => setEmailTemplateData({ ...emailTemplateData, subject: e.target.value })}
                placeholder="🔧 New Work Assignment: {property_address}"
              />
              <p className="text-xs text-gray-500 mt-1">The email subject line the inspector sees in their inbox</p>
            </div>
            <div>
              <Label htmlFor="email-body">Email Body (plain text or HTML)</Label>
              <Textarea
                id="email-body"
                data-testid="textarea-email-body"
                value={emailTemplateData.body}
                onChange={(e) => setEmailTemplateData({ ...emailTemplateData, body: e.target.value })}
                placeholder="Hi {inspector_name}, you have a new PhotoSync assignment at {property_address}. Tap here to start: {crewcam_link}"
                rows={8}
              />
              <p className="text-xs text-gray-500 mt-1">Leave blank to use the default branded template. Supports plain text or HTML.</p>
              {emailTemplateData.body?.trim() && (
                <button
                  type="button"
                  data-testid="button-toggle-assignment-default-preview"
                  onClick={() => setShowAssignmentDefaultPreview(v => !v)}
                  className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  {showAssignmentDefaultPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showAssignmentDefaultPreview ? 'Hide default template' : 'Compare with default template'}
                </button>
              )}
            </div>

            {(!emailTemplateData.body?.trim() || showAssignmentDefaultPreview) && (
              <div
                data-testid="default-preview-assignment-email"
                className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3"
              >
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Default Branded Template — sample values shown
                </p>
                <div
                  data-testid="default-preview-assignment-email-body"
                  className="prose prose-sm max-w-none bg-white rounded border border-blue-100 p-3 text-sm"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(
                      applyReminderMergeFields(getDefaultAssignmentEmailHTML(companyData.brand_primary_color), myCompany?.company_name),
                      { USE_PROFILES: { html: true } }
                    ),
                  }}
                />
                <p className="text-[11px] text-blue-700/80 italic">
                  This is what inspectors receive when you leave the email body blank. The header and button use your brand color.
                </p>
              </div>
            )}

            {(emailTemplateData.subject || emailTemplateData.body) && (
              <div
                data-testid="preview-assignment-email"
                className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3"
              >
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Recipient Preview — sample values shown
                </p>
                {emailTemplateData.subject && (
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Subject</p>
                    <p
                      data-testid="preview-assignment-email-subject"
                      className="text-sm font-medium text-gray-900"
                    >
                      {applyReminderMergeFields(emailTemplateData.subject, myCompany?.company_name)}
                    </p>
                  </div>
                )}
                {emailTemplateData.body && (
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Body</p>
                    {/<[a-z][\s\S]*>/i.test(emailTemplateData.body) ? (
                      <div
                        data-testid="preview-assignment-email-body"
                        className="prose prose-sm max-w-none text-gray-800 bg-white rounded border border-blue-100 p-3 text-sm"
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(
                            applyReminderMergeFields(emailTemplateData.body, myCompany?.company_name),
                            { USE_PROFILES: { html: true } }
                          ),
                        }}
                      />
                    ) : (
                      <pre
                        data-testid="preview-assignment-email-body"
                        className="whitespace-pre-wrap text-sm text-gray-800 bg-white rounded border border-blue-100 p-3 font-sans"
                      >
                        {applyReminderMergeFields(emailTemplateData.body, myCompany?.company_name)}
                      </pre>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-blue-700/80 italic">
                  This is exactly what the inspector will see, with merge fields like {'{property_address}'} and {'{inspector_name}'} replaced by example values. At send time, real values for the actual job are used.
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                data-testid="button-save-email-template"
                onClick={() => saveEmailTemplateMutation.mutate(emailTemplateData)}
                disabled={saveEmailTemplateMutation.isPending || !myCompany}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {saveEmailTemplateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Email Template
              </Button>
            </div>
          </div>

          <div className="border-t pt-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-green-600" /> Inspector Assignment SMS
            </h3>
            <div>
              <Label htmlFor="sms-message">SMS Message</Label>
              <Textarea
                id="sms-message"
                data-testid="textarea-sms-message"
                value={smsTemplateData.message}
                onChange={(e) => setSmsTemplateData({ ...smsTemplateData, message: e.target.value })}
                placeholder="📸 New PhotoSync Assignment — {company_name}&#10;&#10;📍 {property_address}&#10;📅 {scheduled_date}&#10;&#10;Tap to start: {crewcam_link}"
                rows={6}
              />
              <SmsCounter text={smsTemplateData.message} testId="sms-counter-assignment" />
              <MergeFieldLengthWarning text={smsTemplateData.message} expandFn={(t) => applyReminderMergeFields(t, companyData.company_name)} testId="merge-warning-assignment" />
              <p className="text-xs text-gray-500 mt-1">Keep it concise — SMS messages are best under 160 characters per segment. Leave blank to use the default.</p>
            </div>

            {smsTemplateData.message && (
              <div
                data-testid="preview-assignment-sms"
                className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2"
              >
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> Recipient Preview — sample values shown
                </p>
                <div className="flex justify-start">
                  <pre
                    data-testid="preview-assignment-sms-message"
                    className="whitespace-pre-wrap text-sm text-gray-800 bg-white rounded-2xl rounded-tl-sm border border-green-100 px-4 py-3 font-sans max-w-sm shadow-sm"
                  >
                    {applyReminderMergeFields(smsTemplateData.message, myCompany?.company_name)}
                  </pre>
                </div>
                <p className="text-[11px] text-green-700/80 italic">
                  This is exactly what the inspector will see, with merge fields like {'{property_address}'} and {'{client_name}'} replaced by example values. At send time, real values for the actual job are used.
                </p>
              </div>
            )}

            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <Button
                  data-testid="button-send-test-assignment-sms"
                  variant="outline"
                  onClick={sendTestAssignmentSms}
                  disabled={testAssignmentSmsStatus === 'sending' || !myCompany}
                >
                  {testAssignmentSmsStatus === 'sending' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageSquare className="w-4 h-4 mr-2" />}
                  Send Test SMS
                </Button>
                <Button
                  data-testid="button-save-sms-template"
                  onClick={() => saveSmsTemplateMutation.mutate(smsTemplateData)}
                  disabled={saveSmsTemplateMutation.isPending || !myCompany}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {saveSmsTemplateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save SMS Template
                </Button>
              </div>
              <SmsTestStatusFeedback
                status={testAssignmentSmsStatus}
                error={testAssignmentSmsError}
                toPhone={companyData.phone || myCompany?.phone}
                successTestId="text-test-assignment-sms-success"
                notConfiguredTestId="text-test-assignment-sms-not-configured"
                errorTestId="text-test-assignment-sms-error"
              />
            </div>
          </div>

          <div className="border-t pt-6 space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Mail className="w-4 h-4 text-amber-600" /> Resend Reminder Email
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Used when an admin clicks <strong>Resend Link</strong>. If left blank, the original assignment email above will be used as a fallback.
              </p>
            </div>
            <div>
              <Label htmlFor="reminder-email-subject">Subject Line</Label>
              <Input
                id="reminder-email-subject"
                data-testid="input-reminder-email-subject"
                value={reminderEmailTemplateData.subject}
                onChange={(e) => setReminderEmailTemplateData({ ...reminderEmailTemplateData, subject: e.target.value })}
                placeholder="🔁 Reminder: Your PhotoSync link for {property_address}"
              />
            </div>
            <div>
              <Label htmlFor="reminder-email-body">Email Body (plain text or HTML)</Label>
              <Textarea
                id="reminder-email-body"
                data-testid="textarea-reminder-email-body"
                value={reminderEmailTemplateData.body}
                onChange={(e) => setReminderEmailTemplateData({ ...reminderEmailTemplateData, body: e.target.value })}
                placeholder="Hi {inspector_name}, just a quick reminder — here's your PhotoSync link for {property_address}: {crewcam_link}"
                rows={8}
              />
              <p className="text-xs text-gray-500 mt-1">Leave blank to fall back to the assignment email above.</p>
              {reminderEmailTemplateData.body?.trim() && (
                <button
                  type="button"
                  data-testid="button-toggle-reminder-default-preview"
                  onClick={() => setShowReminderDefaultPreview(v => !v)}
                  className="mt-2 flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 font-medium"
                >
                  {showReminderDefaultPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showReminderDefaultPreview ? 'Hide default template' : 'Compare with default template'}
                </button>
              )}
            </div>

            {(!reminderEmailTemplateData.body?.trim() || showReminderDefaultPreview) && (
              <div
                data-testid="default-preview-reminder-email"
                className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3"
              >
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  {emailTemplateData.body
                    ? 'Effective Fallback — Assignment Email Body (sample values shown)'
                    : 'Default Branded Template — sample values shown'}
                </p>
                {emailTemplateData.body ? (
                  <>
                    <p className="text-[11px] text-amber-700/80">
                      Your reminder body is blank, so inspectors will receive your custom <strong>Assignment Email body</strong> as a fallback:
                    </p>
                    {/<[a-z][\s\S]*>/i.test(emailTemplateData.body) ? (
                      <div
                        data-testid="default-preview-reminder-email-body"
                        className="prose prose-sm max-w-none bg-white rounded border border-amber-100 p-3 text-sm"
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(
                            applyReminderMergeFields(emailTemplateData.body, myCompany?.company_name),
                            { USE_PROFILES: { html: true } }
                          ),
                        }}
                      />
                    ) : (
                      <pre
                        data-testid="default-preview-reminder-email-body"
                        className="whitespace-pre-wrap text-sm text-gray-800 bg-white rounded border border-amber-100 p-3 font-sans"
                      >
                        {applyReminderMergeFields(emailTemplateData.body, myCompany?.company_name)}
                      </pre>
                    )}
                  </>
                ) : (
                  <>
                    <div
                      data-testid="default-preview-reminder-email-body"
                      className="prose prose-sm max-w-none bg-white rounded border border-amber-100 p-3 text-sm"
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(
                          applyReminderMergeFields(getDefaultAssignmentEmailHTML(companyData.brand_primary_color), myCompany?.company_name),
                          { USE_PROFILES: { html: true } }
                        ),
                      }}
                    />
                  </>
                )}
                <p className="text-[11px] text-amber-700/80 italic">
                  {emailTemplateData.body
                    ? 'To use a different reminder body, fill in the field above. To use the branded default, leave both assignment and reminder bodies blank.'
                    : 'Both reminder and assignment bodies are blank — inspectors receive this branded default. The header and button use your brand color.'}
                </p>
              </div>
            )}

            {(reminderEmailTemplateData.subject || reminderEmailTemplateData.body) && (
              <div
                data-testid="preview-reminder-email"
                className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3"
              >
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Recipient Preview — sample values shown
                </p>
                {reminderEmailTemplateData.subject && (
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Subject</p>
                    <p
                      data-testid="preview-reminder-email-subject"
                      className="text-sm font-medium text-gray-900"
                    >
                      {applyReminderMergeFields(reminderEmailTemplateData.subject, myCompany?.company_name)}
                    </p>
                  </div>
                )}
                {reminderEmailTemplateData.body && (
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Body</p>
                    {/<[a-z][\s\S]*>/i.test(reminderEmailTemplateData.body) ? (
                      <div
                        data-testid="preview-reminder-email-body"
                        className="prose prose-sm max-w-none text-gray-800 bg-white rounded border border-amber-100 p-3 text-sm"
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(
                            applyReminderMergeFields(reminderEmailTemplateData.body, myCompany?.company_name),
                            { USE_PROFILES: { html: true } }
                          ),
                        }}
                      />
                    ) : (
                      <pre
                        data-testid="preview-reminder-email-body"
                        className="whitespace-pre-wrap text-sm text-gray-800 bg-white rounded border border-amber-100 p-3 font-sans"
                      >
                        {applyReminderMergeFields(reminderEmailTemplateData.body, myCompany?.company_name)}
                      </pre>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-amber-700/80 italic">
                  This is exactly what the inspector will see, with merge fields like {'{property_address}'} and {'{inspector_name}'} replaced by example values. At send time, real values for the actual job are used.
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                data-testid="button-save-reminder-email-template"
                onClick={() => saveReminderEmailTemplateMutation.mutate(reminderEmailTemplateData)}
                disabled={saveReminderEmailTemplateMutation.isPending || !myCompany}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {saveReminderEmailTemplateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Reminder Email
              </Button>
            </div>
          </div>

          <div className="border-t pt-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-amber-600" /> Resend Reminder SMS
            </h3>
            <div>
              <Label htmlFor="reminder-sms-message">SMS Message</Label>
              <Textarea
                id="reminder-sms-message"
                data-testid="textarea-reminder-sms-message"
                value={reminderSmsTemplateData.message}
                onChange={(e) => setReminderSmsTemplateData({ ...reminderSmsTemplateData, message: e.target.value })}
                placeholder="🔁 Reminder from {company_name}: here's your PhotoSync link again for {property_address}.&#10;&#10;{crewcam_link}"
                rows={6}
              />
              <SmsCounter text={reminderSmsTemplateData.message} testId="sms-counter-reminder" />
              <MergeFieldLengthWarning text={reminderSmsTemplateData.message} expandFn={(t) => applyReminderMergeFields(t, companyData.company_name)} testId="merge-warning-reminder" />
              <p className="text-xs text-gray-500 mt-1">Leave blank to fall back to the assignment SMS above.</p>
            </div>

            {reminderSmsTemplateData.message && (
              <div
                data-testid="preview-reminder-sms"
                className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2"
              >
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> Recipient Preview — sample values shown
                </p>
                <div className="flex justify-start">
                  <pre
                    data-testid="preview-reminder-sms-message"
                    className="whitespace-pre-wrap text-sm text-gray-800 bg-white rounded-2xl rounded-tl-sm border border-amber-100 px-4 py-3 font-sans max-w-sm shadow-sm"
                  >
                    {applyReminderMergeFields(reminderSmsTemplateData.message, myCompany?.company_name)}
                  </pre>
                </div>
                <p className="text-[11px] text-amber-700/80 italic">
                  This is exactly what the inspector will see, with merge fields like {'{property_address}'} and {'{scheduled_date}'} replaced by example values. At send time, real values for the actual job are used.
                </p>
              </div>
            )}

            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <Button
                  data-testid="button-send-test-reminder-sms"
                  variant="outline"
                  onClick={sendTestReminderSms}
                  disabled={testReminderSmsStatus === 'sending' || !myCompany}
                >
                  {testReminderSmsStatus === 'sending' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageSquare className="w-4 h-4 mr-2" />}
                  Send Test SMS
                </Button>
                <Button
                  data-testid="button-save-reminder-sms-template"
                  onClick={() => saveReminderSmsTemplateMutation.mutate(reminderSmsTemplateData)}
                  disabled={saveReminderSmsTemplateMutation.isPending || !myCompany}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  {saveReminderSmsTemplateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save Reminder SMS
                </Button>
              </div>
              <SmsTestStatusFeedback
                status={testReminderSmsStatus}
                error={testReminderSmsError}
                toPhone={companyData.phone || myCompany?.phone}
                successTestId="text-test-reminder-sms-success"
                notConfiguredTestId="text-test-reminder-sms-not-configured"
                errorTestId="text-test-reminder-sms-error"
              />
            </div>
          </div>

          <div className="border-t pt-6 space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Mail className="w-4 h-4 text-purple-600" /> Client Inspection Confirmation Email
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Sent to the property owner ({'{client_email}'}) when an inspector is assigned, confirming the scheduled inspection. Leave blank to use the default branded template.
              </p>
            </div>
            <div>
              <Label htmlFor="client-email-subject">Subject Line</Label>
              <Input
                id="client-email-subject"
                data-testid="input-client-email-subject"
                value={clientEmailTemplateData.subject}
                onChange={(e) => setClientEmailTemplateData({ ...clientEmailTemplateData, subject: e.target.value })}
                placeholder="🏠 Property Inspection Scheduled - {property_address}"
              />
              <p className="text-xs text-gray-500 mt-1">The email subject line the client sees in their inbox</p>
            </div>
            <div>
              <Label htmlFor="client-email-body">Email Body (plain text or HTML)</Label>
              <Textarea
                id="client-email-body"
                data-testid="textarea-client-email-body"
                value={clientEmailTemplateData.body}
                onChange={(e) => setClientEmailTemplateData({ ...clientEmailTemplateData, body: e.target.value })}
                placeholder="Hi {client_name}, your inspection at {property_address} is scheduled for {scheduled_date}. Your inspector {inspector_name} will contact you at {inspector_phone}."
                rows={8}
              />
              <p className="text-xs text-gray-500 mt-1">Leave blank to use the default branded template. Supports plain text or HTML.</p>
              {clientEmailTemplateData.body?.trim() && (
                <button
                  type="button"
                  data-testid="button-toggle-client-default-preview"
                  onClick={() => setShowClientDefaultPreview(v => !v)}
                  className="mt-2 flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 font-medium"
                >
                  {showClientDefaultPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showClientDefaultPreview ? 'Hide default template' : 'Compare with default template'}
                </button>
              )}
            </div>

            {(!clientEmailTemplateData.body?.trim() || showClientDefaultPreview) && (
              <div
                data-testid="default-preview-client-email"
                className="rounded-lg border border-purple-200 bg-purple-50 p-4 space-y-3"
              >
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Default Branded Template — sample values shown
                </p>
                <div
                  data-testid="default-preview-client-email-body"
                  className="prose prose-sm max-w-none bg-white rounded border border-purple-100 p-3 text-sm"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(
                      applyReminderMergeFields(getDefaultClientEmailHTML(companyData.brand_primary_color), myCompany?.company_name),
                      { USE_PROFILES: { html: true } }
                    ),
                  }}
                />
                <p className="text-[11px] text-purple-700/80 italic">
                  This is what clients receive when you leave the email body blank. The header uses your brand color.
                </p>
              </div>
            )}

            {(clientEmailTemplateData.subject || clientEmailTemplateData.body) && (
              <div
                data-testid="preview-client-email"
                className="rounded-lg border border-purple-200 bg-purple-50 p-4 space-y-3"
              >
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Recipient Preview — sample values shown
                </p>
                {clientEmailTemplateData.subject && (
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Subject</p>
                    <p
                      data-testid="preview-client-email-subject"
                      className="text-sm font-medium text-gray-900"
                    >
                      {applyReminderMergeFields(clientEmailTemplateData.subject, myCompany?.company_name)}
                    </p>
                  </div>
                )}
                {clientEmailTemplateData.body && (
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Body</p>
                    {/<[a-z][\s\S]*>/i.test(clientEmailTemplateData.body) ? (
                      <div
                        data-testid="preview-client-email-body"
                        className="prose prose-sm max-w-none text-gray-800 bg-white rounded border border-purple-100 p-3 text-sm"
                        dangerouslySetInnerHTML={{
                          __html: DOMPurify.sanitize(
                            applyReminderMergeFields(clientEmailTemplateData.body, myCompany?.company_name),
                            { USE_PROFILES: { html: true } }
                          ),
                        }}
                      />
                    ) : (
                      <pre
                        data-testid="preview-client-email-body"
                        className="whitespace-pre-wrap text-sm text-gray-800 bg-white rounded border border-purple-100 p-3 font-sans"
                      >
                        {applyReminderMergeFields(clientEmailTemplateData.body, myCompany?.company_name)}
                      </pre>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-purple-700/80 italic">
                  This is exactly what the client will see, with merge fields like {'{property_address}'} and {'{client_name}'} replaced by example values. At send time, real values for the actual job are used.
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                data-testid="button-save-client-email-template"
                onClick={() => saveClientEmailTemplateMutation.mutate(clientEmailTemplateData)}
                disabled={saveClientEmailTemplateMutation.isPending || !myCompany}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {saveClientEmailTemplateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Client Email
              </Button>
            </div>
          </div>

          <div className="border-t pt-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-purple-600" /> Client Inspection Confirmation SMS
            </h3>
            <div>
              <Label htmlFor="client-sms-message">SMS Message</Label>
              <Textarea
                id="client-sms-message"
                data-testid="textarea-client-sms-message"
                value={clientSmsTemplateData.message}
                onChange={(e) => setClientSmsTemplateData({ ...clientSmsTemplateData, message: e.target.value })}
                placeholder="✅ Inspection confirmed for {scheduled_date} at {property_address}. Your inspector {inspector_name} will contact you soon at {inspector_phone}. - {company_name}"
                rows={6}
              />
              <SmsCounter text={clientSmsTemplateData.message} testId="sms-counter-client" />
              <MergeFieldLengthWarning text={clientSmsTemplateData.message} expandFn={(t) => applyReminderMergeFields(t, companyData.company_name)} testId="merge-warning-client" />
              <p className="text-xs text-gray-500 mt-1">Sent to {'{client_phone}'} after assignment. Keep it concise — SMS messages are best under 160 characters per segment. Leave blank to use the default.</p>
            </div>

            {clientSmsTemplateData.message && (
              <div
                data-testid="preview-client-sms"
                className="rounded-lg border border-purple-200 bg-purple-50 p-4 space-y-2"
              >
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> Recipient Preview — sample values shown
                </p>
                <div className="flex justify-start">
                  <pre
                    data-testid="preview-client-sms-message"
                    className="whitespace-pre-wrap text-sm text-gray-800 bg-white rounded-2xl rounded-tl-sm border border-purple-100 px-4 py-3 font-sans max-w-sm shadow-sm"
                  >
                    {applyReminderMergeFields(clientSmsTemplateData.message, myCompany?.company_name)}
                  </pre>
                </div>
                <p className="text-[11px] text-purple-700/80 italic">
                  This is exactly what the client will see, with merge fields like {'{client_name}'} and {'{inspector_name}'} replaced by example values. At send time, real values for the actual job are used.
                </p>
              </div>
            )}

            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <Button
                  data-testid="button-send-test-client-sms"
                  variant="outline"
                  onClick={sendTestClientSms}
                  disabled={testClientSmsStatus === 'sending' || !myCompany}
                >
                  {testClientSmsStatus === 'sending' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageSquare className="w-4 h-4 mr-2" />}
                  Send Test SMS
                </Button>
                <Button
                  data-testid="button-save-client-sms-template"
                  onClick={() => saveClientSmsTemplateMutation.mutate(clientSmsTemplateData)}
                  disabled={saveClientSmsTemplateMutation.isPending || !myCompany}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {saveClientSmsTemplateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save Client SMS
                </Button>
              </div>
              <SmsTestStatusFeedback
                status={testClientSmsStatus}
                error={testClientSmsError}
                toPhone={companyData.phone || myCompany?.phone}
                successTestId="text-test-client-sms-success"
                notConfiguredTestId="text-test-client-sms-not-configured"
                errorTestId="text-test-client-sms-error"
              />
            </div>
          </div>

          <div className="border-t pt-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-purple-600" /> Homeowner Photo Upload SMS
            </h3>
            <p className="text-sm text-gray-500">Sent to the assigned PM (or admin fallback) when a homeowner uploads a photo via the portal. Use <code className="bg-gray-100 px-1 rounded">{'{name}'}</code> for the homeowner's name, <code className="bg-gray-100 px-1 rounded">{'{addr}'}</code> for the property address, and <code className="bg-gray-100 px-1 rounded">{'{link}'}</code> for the review link.</p>
            <div>
              <Label htmlFor="homeowner-photo-sms-message">SMS Message</Label>
              <Textarea
                id="homeowner-photo-sms-message"
                data-testid="textarea-homeowner-photo-sms-message"
                value={homeownerPhotoSmsTemplateData.message}
                onChange={(e) => { setHomeownerPhotoSmsTemplateData({ message: e.target.value }); setTestSmsStatus(null); }}
                placeholder="{name} uploaded a photo for [{addr}]. Review: {link}"
                rows={4}
              />
              <SmsCounter text={homeownerPhotoSmsTemplateData.message} testId="sms-counter-homeowner-photo" />
              <MergeFieldLengthWarning
                text={homeownerPhotoSmsTemplateData.message}
                expandFn={(t) =>
                  t
                    .replaceAll('{name}', 'Jane Smith')
                    .replaceAll('{addr}', '123 Maple St, Springfield, IL')
                    .replaceAll('{link}', 'https://getcompanysync.com/projects/preview?tab=photos')
                }
                testId="merge-warning-homeowner-photo"
              />
              <p className="text-xs text-gray-500 mt-1">Keep it concise — SMS messages are best under 160 characters. Leave blank to use the default.</p>
            </div>

            {homeownerPhotoSmsTemplateData.message && (
              <div
                data-testid="preview-homeowner-photo-sms"
                className="rounded-lg border border-purple-200 bg-purple-50 p-4 space-y-2"
              >
                <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> Preview — sample values shown
                </p>
                <div className="flex justify-start">
                  <pre
                    data-testid="preview-homeowner-photo-sms-message"
                    className="whitespace-pre-wrap text-sm text-gray-800 bg-white rounded-2xl rounded-tl-sm border border-purple-100 px-4 py-3 font-sans max-w-sm shadow-sm"
                  >
                    {homeownerPhotoSmsTemplateData.message
                      .replaceAll('{name}', 'Jane Smith')
                      .replaceAll('{addr}', '123 Maple St, Springfield, IL')
                      .replaceAll('{link}', 'https://getcompanysync.com/projects/preview?tab=photos')}
                  </pre>
                </div>
                <p className="text-[11px] text-purple-700/80 italic">
                  {'{name}'}, {'{addr}'}, and {'{link}'} are replaced with real values at send time.
                </p>
              </div>
            )}

            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <Button
                  data-testid="button-send-test-homeowner-photo-sms"
                  variant="outline"
                  onClick={sendTestHomeownerSms}
                  disabled={testSmsStatus === 'sending' || !myCompany}
                >
                  {testSmsStatus === 'sending' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageSquare className="w-4 h-4 mr-2" />}
                  Send Test SMS
                </Button>
                <Button
                  data-testid="button-save-homeowner-photo-sms-template"
                  onClick={() => saveHomeownerPhotoSmsTemplateMutation.mutate(homeownerPhotoSmsTemplateData)}
                  disabled={saveHomeownerPhotoSmsTemplateMutation.isPending || !myCompany}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {saveHomeownerPhotoSmsTemplateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save Homeowner Photo SMS
                </Button>
              </div>
              <SmsTestStatusFeedback
                status={testSmsStatus}
                error={testSmsError}
                toPhone={companyData.phone || myCompany?.phone}
              />
            </div>
          </div>

          <div className="border-t pt-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Mail className="w-4 h-4 text-blue-600" /> Homeowner Photo Upload Email
            </h3>
            <p className="text-sm text-gray-500">Sent to the assigned PM (or admin fallback) when a homeowner uploads a photo via the portal. Use <code className="bg-gray-100 px-1 rounded">{'{name}'}</code> for the homeowner's name, <code className="bg-gray-100 px-1 rounded">{'{addr}'}</code> for the property address, and <code className="bg-gray-100 px-1 rounded">{'{link}'}</code> for the review link. Leave the body blank to use the default branded HTML.</p>
            <div>
              <Label htmlFor="homeowner-photo-email-subject">Subject Line</Label>
              <input
                id="homeowner-photo-email-subject"
                data-testid="input-homeowner-photo-email-subject"
                type="text"
                value={homeownerPhotoEmailTemplateData.subject}
                onChange={(e) => { setHomeownerPhotoEmailTemplateData({ ...homeownerPhotoEmailTemplateData, subject: e.target.value }); setTestEmailStatus(null); }}
                placeholder="📸 New Photo Uploaded: {addr}"
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <Label htmlFor="homeowner-photo-email-body">Email Body (HTML or plain text)</Label>
              <Textarea
                id="homeowner-photo-email-body"
                data-testid="textarea-homeowner-photo-email-body"
                value={homeownerPhotoEmailTemplateData.body}
                onChange={(e) => { setHomeownerPhotoEmailTemplateData({ ...homeownerPhotoEmailTemplateData, body: e.target.value }); setTestEmailStatus(null); }}
                placeholder={`<p><strong>{name}</strong> uploaded a photo for the project at <strong>{addr}</strong>.</p>\n<p>The photo is pending your review.</p>\n<p><a href="{link}">Review Photo</a></p>`}
                rows={6}
              />
              <p className="text-xs text-gray-500 mt-1">HTML is supported. Leave blank to use the default branded template.</p>
            </div>

            {!homeownerPhotoEmailTemplateData.body?.trim() && (
              <div
                data-testid="default-preview-homeowner-photo-email"
                className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3"
              >
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide flex items-center gap-1">
                  <Eye className="w-3 h-3" /> Default Branded Template — sample values shown
                </p>
                <div
                  data-testid="default-preview-homeowner-photo-email-body"
                  className="prose prose-sm max-w-none bg-white rounded border border-blue-100 p-3 text-sm"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(
                      `<div style="font-family:Arial,sans-serif;color:#333"><h2 style="color:${companyData.brand_primary_color || '#2563eb'}">New Homeowner Photo Upload</h2><p><strong>Jane Smith</strong> uploaded a photo for the project at <strong>123 Maple St, Springfield, IL</strong>.</p><p>The photo is pending your review.</p><p style="margin-top:20px"><a href="https://getcompanysync.com/projects/preview?tab=photos" style="background:${companyData.brand_primary_color || '#2563eb'};color:white;padding:10px 20px;border-radius:4px;text-decoration:none">Review Photo</a></p></div>`,
                      { USE_PROFILES: { html: true } }
                    ),
                  }}
                />
                <p className="text-[11px] text-blue-700/80 italic">
                  This is what homeowners receive when you leave the email body blank. The header and button use your brand color.
                </p>
              </div>
            )}

            {(homeownerPhotoEmailTemplateData.subject || homeownerPhotoEmailTemplateData.body) && (
              <div
                data-testid="preview-homeowner-photo-email"
                className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-2"
              >
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Preview — sample values shown
                </p>
                {homeownerPhotoEmailTemplateData.subject && (
                  <p className="text-xs text-blue-800">
                    <span className="font-semibold">Subject: </span>
                    {homeownerPhotoEmailTemplateData.subject
                      .replaceAll('{name}', 'Jane Smith')
                      .replaceAll('{addr}', '123 Maple St, Springfield, IL')
                      .replaceAll('{link}', 'https://getcompanysync.com/projects/preview?tab=photos')}
                  </p>
                )}
                {homeownerPhotoEmailTemplateData.body && (
                  <div className="text-sm text-gray-800 bg-white rounded border border-blue-100 px-4 py-3">
                    {/<[a-z][\s\S]*>/i.test(homeownerPhotoEmailTemplateData.body) ? (
                      <div dangerouslySetInnerHTML={{ __html:
                        DOMPurify.sanitize(
                          homeownerPhotoEmailTemplateData.body
                            .replaceAll('{name}', 'Jane Smith')
                            .replaceAll('{addr}', '123 Maple St, Springfield, IL')
                            .replaceAll('{link}', 'https://getcompanysync.com/projects/preview?tab=photos'),
                          { USE_PROFILES: { html: true } }
                        )
                      }} />
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans">
                        {homeownerPhotoEmailTemplateData.body
                          .replaceAll('{name}', 'Jane Smith')
                          .replaceAll('{addr}', '123 Maple St, Springfield, IL')
                          .replaceAll('{link}', 'https://getcompanysync.com/projects/preview?tab=photos')}
                      </pre>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-blue-700/80 italic">
                  {'{name}'}, {'{addr}'}, and {'{link}'} are replaced with real values at send time.
                </p>
              </div>
            )}

            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                {isAdmin && (
                  <Button
                    data-testid="button-send-test-homeowner-photo-email"
                    variant="outline"
                    onClick={sendTestHomeownerEmail}
                    disabled={testEmailStatus === 'sending' || !myCompany || !user?.email}
                  >
                    {testEmailStatus === 'sending' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
                    Send Test Email
                  </Button>
                )}
                <Button
                  data-testid="button-save-homeowner-photo-email-template"
                  onClick={() => saveHomeownerPhotoEmailTemplateMutation.mutate(homeownerPhotoEmailTemplateData)}
                  disabled={saveHomeownerPhotoEmailTemplateMutation.isPending || !myCompany}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {saveHomeownerPhotoEmailTemplateMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save Homeowner Photo Email
                </Button>
              </div>
              {isAdmin && testEmailStatus === 'success' && (
                <p data-testid="text-test-email-success" className="text-sm text-green-600">
                  Test email sent to {user?.email} via {testEmailProvider}. Message ID:{' '}
                  <code data-testid="text-test-email-message-id" className="font-mono text-xs">{testEmailMessageId}</code>
                </p>
              )}
              {isAdmin && testEmailStatus === 'not_configured' && (
                <div data-testid="text-test-email-not-configured" className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 max-w-sm text-right">
                  <strong>Email service not configured.</strong> Configure{' '}
                  <code className="bg-amber-100 px-1 rounded text-xs">POSTMARK_SERVER_TOKEN</code>{' '}
                  (or AWS SES credentials) in your environment or email integration settings.
                </div>
              )}
              {isAdmin && testEmailStatus === 'error' && (
                <p data-testid="text-test-email-error" className="text-sm text-red-600">
                  Failed to send: {testEmailError}
                </p>
              )}
            </div>
          </div>

        </CardContent>
      </Card>

      <Card className="bg-white shadow-md">
        <CardHeader className="border-b bg-gray-50">
          <div className="flex items-center gap-2">
            <Mic className="w-5 h-5 text-green-600" />
            <CardTitle>Voice Command Cheat Sheet</CardTitle>
          </div>
          <p className="text-sm text-gray-500 mt-1">Customize the example voice commands shown in the guided inspection hint panel. Inspectors will see these commands when hands-free mode is activated.</p>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 space-y-6">

          {(['photos', 'sections', 'counters']).map((category) => {
            const labels = { photos: '📷 Photos', sections: '📍 Sections', counters: '🔢 Counters' };
            const placeholders = {
              photos: 'e.g. snap photo',
              sections: 'e.g. front slope',
              counters: 'e.g. another vent',
            };
            const cmds = companyData.voice_cheat_sheet?.[category] || [];
            return (
              <div key={category} className="space-y-2">
                <p className="text-sm font-semibold text-gray-700">{labels[category]}</p>
                <div className="flex flex-wrap gap-2 min-h-[32px]">
                  {cmds.map((cmd, idx) => (
                    <span
                      key={idx}
                      data-testid={`chip-voice-${category}-${idx}`}
                      className="inline-flex items-center gap-1 bg-gray-100 border border-gray-200 rounded-full px-3 py-1 text-sm font-mono"
                    >
                      "{cmd}"
                      <button
                        type="button"
                        data-testid={`button-remove-voice-${category}-${idx}`}
                        onClick={() => {
                          const updated = cmds.filter((_, i) => i !== idx);
                          setCompanyData({
                            ...companyData,
                            voice_cheat_sheet: { ...companyData.voice_cheat_sheet, [category]: updated },
                          });
                        }}
                        className="text-gray-400 hover:text-red-500 ml-1"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  {cmds.length === 0 && (
                    <span className="text-sm text-gray-400 italic">No commands — defaults will be shown</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    data-testid={`input-new-voice-${category}`}
                    value={newVoiceCmd[category]}
                    onChange={(e) => setNewVoiceCmd({ ...newVoiceCmd, [category]: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const val = newVoiceCmd[category].trim().toLowerCase();
                        if (val && !cmds.includes(val)) {
                          setCompanyData({
                            ...companyData,
                            voice_cheat_sheet: { ...companyData.voice_cheat_sheet, [category]: [...cmds, val] },
                          });
                          setNewVoiceCmd({ ...newVoiceCmd, [category]: '' });
                        }
                      }
                    }}
                    placeholder={placeholders[category]}
                    className="max-w-xs"
                  />
                  <Button
                    type="button"
                    data-testid={`button-add-voice-${category}`}
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const val = newVoiceCmd[category].trim().toLowerCase();
                      if (val && !cmds.includes(val)) {
                        setCompanyData({
                          ...companyData,
                          voice_cheat_sheet: { ...companyData.voice_cheat_sheet, [category]: [...cmds, val] },
                        });
                        setNewVoiceCmd({ ...newVoiceCmd, [category]: '' });
                      }
                    }}
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add
                  </Button>
                </div>
              </div>
            );
          })}

          <p className="text-xs text-gray-400 pt-2 border-t">These commands are display hints only. Voice recognition still accepts the full range of built-in commands. Save using the button at the bottom of the page.</p>
        </CardContent>
      </Card>

      <Card className="bg-white shadow-md">
        <CardHeader className="border-b bg-gray-50">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            <CardTitle>Default Notes & Disclaimers</CardTitle>
          </div>
          <p className="text-sm text-gray-500 mt-1">Set default notes and disclaimers for estimates, invoices, and proposals. These will auto-fill on new documents but can be overridden per document.</p>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 space-y-8">

          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">📋 Estimates</h3>
            <div>
              <Label>Default Estimate Notes</Label>
              <Textarea
                value={companyData.default_estimate_notes}
                onChange={(e) => updateDocumentDefault('default_estimate_notes', e.target.value)}
                placeholder="e.g., This estimate is valid for 30 days. A 50% deposit is required upon acceptance."
                rows={3}
              />
              <p className="text-xs text-gray-500 mt-1">Shown to customers on the estimate</p>
            </div>
            <div>
              <Label>Default Estimate Disclaimer</Label>
              <Textarea
                value={companyData.default_estimate_disclaimer}
                onChange={(e) => updateDocumentDefault('default_estimate_disclaimer', e.target.value)}
                placeholder="e.g., This estimate covers visible and disclosed damage only. Additional repairs discovered during work will require supplemental approval..."
                rows={4}
              />
              <p className="text-xs text-gray-500 mt-1">Legal disclaimer shown at the bottom of estimates</p>
            </div>
          </div>

          <div className="border-t pt-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">🧾 Invoices</h3>
            <div>
              <Label>Default Invoice Notes</Label>
              <Textarea
                value={companyData.default_invoice_notes}
                onChange={(e) => updateDocumentDefault('default_invoice_notes', e.target.value)}
                placeholder="e.g., Payment is due within 30 days. Late fees may apply after due date."
                rows={3}
              />
              <p className="text-xs text-gray-500 mt-1">Shown to customers on the invoice</p>
            </div>
            <div>
              <Label>Default Invoice Disclaimer</Label>
              <Textarea
                value={companyData.default_invoice_disclaimer}
                onChange={(e) => updateDocumentDefault('default_invoice_disclaimer', e.target.value)}
                placeholder="e.g., All work is warranted for 1 year from date of completion unless otherwise stated..."
                rows={4}
              />
              <p className="text-xs text-gray-500 mt-1">Legal disclaimer shown at the bottom of invoices</p>
            </div>
          </div>

          <div className="border-t pt-6 space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">📄 Proposals</h3>
            <div>
              <Label>Default Proposal Notes</Label>
              <Textarea
                value={companyData.default_proposal_notes}
                onChange={(e) => updateDocumentDefault('default_proposal_notes', e.target.value)}
                placeholder="e.g., This proposal is valid for 30 days from the date of issue."
                rows={3}
              />
              <p className="text-xs text-gray-500 mt-1">Shown to customers on the proposal</p>
            </div>
            <div>
              <Label>Default Proposal Disclaimer</Label>
              <Textarea
                value={companyData.default_proposal_disclaimer}
                onChange={(e) => updateDocumentDefault('default_proposal_disclaimer', e.target.value)}
                placeholder="e.g., Pricing is subject to change based on unforeseen site conditions..."
                rows={4}
              />
              <p className="text-xs text-gray-500 mt-1">Legal disclaimer shown at the bottom of proposals</p>
            </div>
          </div>

        </CardContent>
      </Card>

      <Card className="bg-white shadow-md">
        <CardHeader className="border-b bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-600" />
              <CardTitle>Quick Create Shortcuts</CardTitle>
            </div>
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${quickCreateShortcuts.length >= 10 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
              {quickCreateShortcuts.length} / 10 enabled
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Choose which items appear in the "+ Quick Create" header dropdown, and in what order.
            If none are selected, the default 7 shortcuts will be shown.
          </p>
          {!isAdmin && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
              Only company administrators can modify Quick Create shortcuts.
            </p>
          )}
        </CardHeader>
        <CardContent className="pt-5 space-y-3">
          {quickCreateShortcuts.length > 0 && (
            <div className="mb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Enabled (drag to reorder with arrows)</p>
              <div className="space-y-1.5">
                {quickCreateShortcuts.map((slot, idx) => {
                  const item = SHORTCUT_CATALOG.find((s) => s.id === slot.id);
                  if (!item) return null;
                  const Icon = item.icon;
                  const activeColor = slot.color || item.color;
                  const pillBgColor = (() => {
                    const tc = slot.color || null;
                    if (tc && tc.startsWith("text-")) return tc.replace("text-", "bg-");
                    return PILL_COLOR_MAP[slot.id] || "bg-blue-500";
                  })();
                  return (
                    <div
                      key={slot.id}
                      className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2"
                      data-testid={`shortcut-enabled-${slot.id}`}
                    >
                      <Icon className={`w-4 h-4 flex-shrink-0 ${activeColor}`} />
                      <span className="flex-1 text-sm font-medium text-gray-800">{item.label}</span>
                      <span
                        className={`${pillBgColor} text-white rounded-full flex items-center gap-1 pl-1.5 pr-2.5 py-1 text-xs font-medium flex-shrink-0`}
                        title="Mobile pill preview"
                        data-testid={`pill-preview-${slot.id}`}
                      >
                        <Icon className="w-3 h-3" />
                        {item.label}
                      </span>
                      <div className="flex items-center gap-0.5 mr-1" title="Icon color">
                        {['text-blue-500','text-teal-500','text-orange-500','text-purple-500','text-amber-500','text-pink-500','text-green-500','text-indigo-500','text-cyan-500','text-red-500','text-slate-500','text-gray-600'].map((tc) => (
                          <button
                            key={tc}
                            type="button"
                            onClick={() => isAdmin && setQuickCreateShortcuts((prev) => prev.map((s, i) => i === idx ? { ...s, color: tc } : s))}
                            disabled={!isAdmin}
                            className={`w-3 h-3 rounded-full border ${activeColor === tc || (!slot.color && tc === item.color) ? 'border-gray-800 scale-125' : 'border-transparent hover:border-gray-400'} ${tc.replace('text-', 'bg-').replace('-500', '-400').replace('-600', '-500')} ${!isAdmin ? 'opacity-40 cursor-not-allowed' : ''}`}
                            aria-label={`Set color ${tc}`}
                            data-testid={`swatch-${slot.id}-${tc}`}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleShortcutMoveUp(idx)}
                          disabled={!isAdmin || idx === 0}
                          className="p-1 rounded hover:bg-blue-100 disabled:opacity-30 disabled:cursor-not-allowed"
                          data-testid={`button-shortcut-up-${slot.id}`}
                          aria-label={`Move ${item.label} up`}
                        >
                          <ChevronUp className="w-3.5 h-3.5 text-gray-600" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleShortcutMoveDown(idx)}
                          disabled={!isAdmin || idx === quickCreateShortcuts.length - 1}
                          className="p-1 rounded hover:bg-blue-100 disabled:opacity-30 disabled:cursor-not-allowed"
                          data-testid={`button-shortcut-down-${slot.id}`}
                          aria-label={`Move ${item.label} down`}
                        >
                          <ChevronDown className="w-3.5 h-3.5 text-gray-600" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleShortcutToggle(slot.id)}
                          disabled={!isAdmin}
                          className="ml-1 p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                          data-testid={`button-shortcut-remove-${slot.id}`}
                          aria-label={`Remove ${item.label}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {quickCreateShortcuts.length > 0 ? 'Available to add' : 'Choose shortcuts'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {SHORTCUT_CATALOG.filter((s) => !quickCreateShortcuts.some((sl) => sl.id === s.id)).map((item) => {
                const Icon = item.icon;
                const atLimit = quickCreateShortcuts.length >= 10;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => isAdmin && !atLimit && handleShortcutToggle(item.id)}
                    disabled={!isAdmin || atLimit}
                    className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-left transition-colors ${!isAdmin || atLimit ? 'opacity-40 cursor-not-allowed bg-gray-50 border-gray-200' : 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300 cursor-pointer'}`}
                    data-testid={`button-shortcut-add-${item.id}`}
                    title={!isAdmin ? 'Only admins can modify shortcuts' : atLimit ? 'Maximum 10 shortcuts' : `Add ${item.label}`}
                  >
                    <Icon className={`w-4 h-4 flex-shrink-0 ${item.color}`} />
                    <span className="text-sm text-gray-700">{item.label}</span>
                    <Plus className="w-3.5 h-3.5 ml-auto text-gray-400" />
                  </button>
                );
              })}
            </div>
          </div>

          {quickCreateShortcuts.length === 0 && (
            <p className="text-xs text-gray-400 italic pt-1">
              No shortcuts selected — the default set (Lead, Estimate, Invoice, Customer, Build/Job, Inspection, Task) will be shown.
            </p>
          )}

          <div className="flex items-center justify-between pt-3 border-t mt-2">
            {quickCreateShortcuts.length > 0 && (
              <button
                type="button"
                onClick={() => { setQuickCreateShortcuts([]); }}
                disabled={!isAdmin}
                className="text-xs text-gray-400 hover:text-gray-600 underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                data-testid="button-shortcuts-reset"
              >
                Reset to defaults
              </button>
            )}
            <div className="ml-auto flex items-center gap-3">
              {shortcutsSaved && (
                <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                </span>
              )}
              <Button
                type="button"
                onClick={() => saveShortcutsMutation.mutate(quickCreateShortcuts)}
                disabled={!isAdmin || saveShortcutsMutation.isPending || !myCompany}
                className="bg-blue-600 hover:bg-blue-700 text-sm"
                size="sm"
                data-testid="button-save-shortcuts"
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {saveShortcutsMutation.isPending ? "Saving…" : "Save Shortcuts"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          className="bg-blue-600 hover:bg-blue-700"
          disabled={saveCompanyMutation.isPending}
        >
          <Save className="w-4 h-4 mr-2" />
          {saveCompanyMutation.isPending ? "Saving..." : myCompany ? "Update Company Profile" : "Create Company Profile"}
        </Button>
      </div>
    </div>
  );
}