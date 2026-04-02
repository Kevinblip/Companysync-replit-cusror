import React, { useState, useEffect, useMemo } from "react";
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
import { Building2, Save, Upload, Loader2, Plus, X, CalendarCheck, FileText, Globe } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";

const timezones = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"
];

export default function CompanySetup() {
  const [user, setUser] = useState(null);
  // `uploading` state is replaced by useMutation's `isPending` status.
  const [companyData, setCompanyData] = useState({
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
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
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

  useEffect(() => {
    if (myCompany) {
      console.log('📋 Loading company data into form:', {
        id: myCompany.id,
        name: myCompany.company_name,
        email: myCompany.email,
        phone: myCompany.phone,
        settings: myCompany.settings
      });
      
      setCompanyData({
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
        time_zone: myCompany.settings?.time_zone || "America/New_York",
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
        default_estimate_notes: myCompany.default_estimate_notes || "",
        default_estimate_disclaimer: myCompany.default_estimate_disclaimer || "",
        default_invoice_notes: myCompany.default_invoice_notes || "",
        default_invoice_disclaimer: myCompany.default_invoice_disclaimer || "",
        default_proposal_notes: myCompany.default_proposal_notes || "",
        default_proposal_disclaimer: myCompany.default_proposal_disclaimer || "",
        preferred_language: myCompany.preferred_language || "en",
      });
    } else {
      console.log('⚠️ No company found - using placeholder values');
    }
  }, [myCompany]);

  const saveCompanyMutation = useMutation({
    mutationFn: (data) => {
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
      };

      const finalPayload = {
        ...restOfCompanyData,
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
        return base44.entities.Company.create(finalPayload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['translation-company'] });
      alert("✅ Company profile saved successfully!");
    },
    onError: (error) => {
      console.error('❌ Save error:', error);
      alert("Failed to save: " + error.message);
    },
  });

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
    saveCompanyMutation.mutate(companyData);
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
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
        <CardContent className="p-6 space-y-6"> {/* Retain original padding/spacing */}

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
              <Label>Industry</Label>
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
              <Label>Time Zone</Label>
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
                Platform Language
              </Label>
              <Select value={companyData.preferred_language} onValueChange={(v) => {
                setCompanyData({ ...companyData, preferred_language: v });
                try { localStorage.setItem('crewcam_language', v); } catch {}
              }}>
                <SelectTrigger data-testid="select-preferred-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="es">Español (Spanish)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">Sets the language for the entire CRM interface for all users in your company</p>
            </div>

            <div>
              <Label>Website</Label>
              <Input
                value={companyData.website}
                onChange={(e) => setCompanyData({ ...companyData, website: e.target.value })}
                placeholder="https://yourcompany.com"
              />
            </div>

            <div>
              <Label>Email *</Label>
              <Input
                type="email"
                value={companyData.email}
                onChange={(e) => setCompanyData({ ...companyData, email: e.target.value })}
                placeholder="info@yourcompany.com"
              />
            </div>

            <div>
              <Label>Phone</Label>
              <Input
                value={companyData.phone}
                onChange={(e) => setCompanyData({ ...companyData, phone: e.target.value })}
                placeholder="(555) 123-4567"
              />
            </div>

            <div className="md:col-span-2">
              <Label>Address</Label>
              <Input
                value={companyData.address}
                onChange={(e) => setCompanyData({ ...companyData, address: e.target.value })}
                placeholder="123 Main Street"
              />
            </div>

            <div>
              <Label>City</Label>
              <Input
                value={companyData.city}
                onChange={(e) => setCompanyData({ ...companyData, city: e.target.value })}
                placeholder="Dallas"
              />
            </div>

            <div>
              <Label>State</Label>
              <Input
                value={companyData.state}
                onChange={(e) => setCompanyData({ ...companyData, state: e.target.value })}
                placeholder="TX"
                maxLength={2}
              />
            </div>

            <div>
              <Label>ZIP Code</Label>
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
        <CardContent className="p-6">
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
          <CardTitle>Business Settings</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div>
            <Label>Default Tax Rate (%)</Label>
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
                <Label>Invoice Prefix</Label>
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
                <Label>Estimate Prefix</Label>
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
        <CardContent className="p-6 space-y-6">

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
            <FileText className="w-5 h-5 text-blue-600" />
            <CardTitle>Default Notes & Disclaimers</CardTitle>
          </div>
          <p className="text-sm text-gray-500 mt-1">Set default notes and disclaimers for estimates, invoices, and proposals. These will auto-fill on new documents but can be overridden per document.</p>
        </CardHeader>
        <CardContent className="p-6 space-y-8">

          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">📋 Estimates</h3>
            <div>
              <Label>Default Estimate Notes</Label>
              <Textarea
                value={companyData.default_estimate_notes}
                onChange={(e) => setCompanyData({ ...companyData, default_estimate_notes: e.target.value })}
                placeholder="e.g., This estimate is valid for 30 days. A 50% deposit is required upon acceptance."
                rows={3}
              />
              <p className="text-xs text-gray-500 mt-1">Shown to customers on the estimate</p>
            </div>
            <div>
              <Label>Default Estimate Disclaimer</Label>
              <Textarea
                value={companyData.default_estimate_disclaimer}
                onChange={(e) => setCompanyData({ ...companyData, default_estimate_disclaimer: e.target.value })}
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
                onChange={(e) => setCompanyData({ ...companyData, default_invoice_notes: e.target.value })}
                placeholder="e.g., Payment is due within 30 days. Late fees may apply after due date."
                rows={3}
              />
              <p className="text-xs text-gray-500 mt-1">Shown to customers on the invoice</p>
            </div>
            <div>
              <Label>Default Invoice Disclaimer</Label>
              <Textarea
                value={companyData.default_invoice_disclaimer}
                onChange={(e) => setCompanyData({ ...companyData, default_invoice_disclaimer: e.target.value })}
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
                onChange={(e) => setCompanyData({ ...companyData, default_proposal_notes: e.target.value })}
                placeholder="e.g., This proposal is valid for 30 days from the date of issue."
                rows={3}
              />
              <p className="text-xs text-gray-500 mt-1">Shown to customers on the proposal</p>
            </div>
            <div>
              <Label>Default Proposal Disclaimer</Label>
              <Textarea
                value={companyData.default_proposal_disclaimer}
                onChange={(e) => setCompanyData({ ...companyData, default_proposal_disclaimer: e.target.value })}
                placeholder="e.g., Pricing is subject to change based on unforeseen site conditions..."
                rows={4}
              />
              <p className="text-xs text-gray-500 mt-1">Legal disclaimer shown at the bottom of proposals</p>
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