import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Upload, Save, Eye, Palette, FileText, Check } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function PDFBranding() {
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState(null);
  const queryClient = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-branding', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['companies-branding'],
    queryFn: () => base44.entities.Company.filter({ is_deleted: { $ne: true } }),
    initialData: [],
  });

  // Match company logic from Layout - find owned OR staffed company
  const myCompany = React.useMemo(() => {
    if (!user) return null;
    
    // Check for impersonation
    const impersonatedId = sessionStorage.getItem('impersonating_company_id');
    if (impersonatedId) {
      const target = companies.find(c => c.id === impersonatedId);
      if (target) return target;
    }
    
    // Find owned company
    const owned = companies.find(c => c.created_by === user.email);
    if (owned) return owned;
    
    // Find via staff profile
    if (staffProfiles.length > 0 && staffProfiles[0].company_id) {
      return companies.find(c => c.id === staffProfiles[0].company_id);
    }
    
    return null;
  }, [user, companies, staffProfiles]);

  React.useEffect(() => {
    if (myCompany && !formData) {
      setFormData({
        logo_url: myCompany.logo_url || "",
        brand_primary_color: myCompany.brand_primary_color || "#3b82f6",
        brand_secondary_color: myCompany.brand_secondary_color || "#8b5cf6",
        pdf_header_text: myCompany.pdf_header_text || "",
        pdf_footer_text: myCompany.pdf_footer_text || "Thank you for your business!",
        pdf_terms_conditions: myCompany.pdf_terms_conditions || "",
        pdf_font_family: myCompany.pdf_font_family || "helvetica",
        pdf_show_logo: myCompany.pdf_show_logo !== false,
        pdf_logo_position: myCompany.pdf_logo_position || "left"
      });
    }
  }, [myCompany]);

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      // Upload to get URL
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      setFormData({ ...formData, logo_url: file_url });
      
      // Auto-save to database immediately
      await base44.entities.Company.update(myCompany.id, {
        logo_url: file_url
      });
      
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['companies-branding'] });
      alert('✅ Logo uploaded and saved!');
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload logo: ' + error.message);
    }
    setIsUploading(false);
  };

  const handleSave = async () => {
    if (!myCompany) {
      alert('No company found. Please complete setup first.');
      return;
    }

    setIsSaving(true);
    try {
      // Explicitly save all branding fields (logo_url managed via Company Setup)
      const updateData = {
        brand_primary_color: formData.brand_primary_color,
        brand_secondary_color: formData.brand_secondary_color,
        pdf_header_text: formData.pdf_header_text,
        pdf_footer_text: formData.pdf_footer_text,
        pdf_terms_conditions: formData.pdf_terms_conditions,
        pdf_font_family: formData.pdf_font_family,
        pdf_show_logo: formData.pdf_show_logo,
        pdf_logo_position: formData.pdf_logo_position
      };
      

      
      await base44.entities.Company.update(myCompany.id, updateData);
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      alert('✅ PDF branding settings saved!');
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to save: ' + error.message);
    }
    setIsSaving(false);
  };

  const handlePreview = async () => {
    try {
      console.log('🔍 Preview - Current company data:', {
        company_id: myCompany?.id,
        company_name: myCompany?.company_name,
        brand_primary_color: myCompany?.brand_primary_color,
        has_logo_url: !!myCompany?.logo_url
      });
      
      // Pass the company ID to ensure the correct company is used
      const response = await base44.functions.invoke('generateEstimatePDF', {
        estimate: {
          estimate_number: 'PREVIEW-001',
          line_items: [
            { description: "Sample Item 1", quantity: 10, unit: "SQ", rate: 350, rcv: 3500, acv: 3500 },
            { description: "Sample Item 2", quantity: 100, unit: "LF", rate: 5, rcv: 500, acv: 500 },
            { description: "Sample Item 3", quantity: 1, unit: "EA", rate: 250, rcv: 250, acv: 250 }
          ],
          total_rcv: 4250,
          total_acv: 4250
        },
        customerInfo: {
          customer_name: "John Smith (Sample)",
          customer_email: "john@example.com",
          customer_phone: "(555) 123-4567",
          property_address: "123 Main St, City, ST 12345",
          claim_number: "CLM-2024-001",
          insurance_company: "Sample Insurance Co."
        },
        format: { show_rcv_acv: true },
        impersonated_company_id: myCompany?.id,
        returnBase64: true
      });

      // Response contains base64 encoded PDF
      const base64Data = response.data.base64;
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      alert('Failed to generate preview: ' + error.message);
    }
  };

  if (isLoading || !formData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading branding settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Palette className="w-8 h-8 text-purple-600" />
            PDF Branding & Customization
          </h1>
          <p className="text-gray-500 mt-1">Customize how your estimates and invoices look</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handlePreview} variant="outline">
            <Eye className="w-4 h-4 mr-2" />
            Preview PDF
          </Button>
          <Button onClick={handleSave} disabled={isSaving} className="bg-green-600 hover:bg-green-700">
            {isSaving ? 'Saving...' : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="branding" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="branding">Logo & Colors</TabsTrigger>
          <TabsTrigger value="content">Content & Text</TabsTrigger>
          <TabsTrigger value="layout">Layout & Style</TabsTrigger>
        </TabsList>

        <TabsContent value="branding" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Company Logo</CardTitle>
              <CardDescription>Upload your company logo (recommended: 300x100px PNG with transparent background)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {formData.logo_url && (
                <div className="border rounded-lg p-4 bg-gray-50">
                  <img 
                    src={formData.logo_url} 
                    alt="Company Logo" 
                    className="max-h-24 object-contain"
                  />
                </div>
              )}

              {myCompany?.logo_url && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm text-green-900 flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Using logo from Company Setup. The PDF generator will automatically fetch it.
                  </p>
                </div>
              )}

              {!myCompany?.logo_url && (
                <div className="flex gap-3">
                  <Button
                    onClick={() => document.getElementById('logo-upload').click()}
                    disabled={isUploading}
                    variant="outline"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    {isUploading ? 'Uploading...' : 'Upload Logo'}
                  </Button>
                  <input
                    id="logo-upload"
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                </div>
              )}
              <p className="text-xs text-gray-500">
                To change your logo, go to <a href="/CompanySetup" className="text-blue-600 underline">Company Setup</a>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Brand Colors</CardTitle>
              <CardDescription>Choose colors that match your brand identity</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label>Primary Color (Headers, Titles)</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <input
                      type="color"
                      value={formData.brand_primary_color}
                      onChange={(e) => {
                        console.log('Primary color changed to:', e.target.value);
                        setFormData({ ...formData, brand_primary_color: e.target.value });
                      }}
                      className="w-16 h-16 rounded-lg border-2 cursor-pointer"
                    />
                    <div className="flex-1">
                      <Input
                        value={formData.brand_primary_color}
                        onChange={(e) => setFormData({ ...formData, brand_primary_color: e.target.value })}
                        placeholder="#3b82f6"
                      />
                      <p className="text-xs text-gray-500 mt-1">Used for table headers and section titles</p>
                    </div>
                  </div>
                </div>

                <div>
                  <Label>Secondary Color (Accents, Badges)</Label>
                  <div className="flex items-center gap-3 mt-2">
                    <input
                      type="color"
                      value={formData.brand_secondary_color}
                      onChange={(e) => {
                        console.log('Secondary color changed to:', e.target.value);
                        setFormData({ ...formData, brand_secondary_color: e.target.value });
                      }}
                      className="w-16 h-16 rounded-lg border-2 cursor-pointer"
                    />
                    <div className="flex-1">
                      <Input
                        value={formData.brand_secondary_color}
                        onChange={(e) => setFormData({ ...formData, brand_secondary_color: e.target.value })}
                        placeholder="#8b5cf6"
                      />
                      <p className="text-xs text-gray-500 mt-1">Used for highlights and badges</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-6 border-2 border-blue-200">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  Color Preview
                </h4>
                <div className="space-y-3">
                  <div 
                    className="h-12 rounded flex items-center px-4 text-white font-semibold"
                    style={{ backgroundColor: formData.brand_primary_color }}
                  >
                    Primary Color - Headers & Titles
                  </div>
                  <div 
                    className="h-12 rounded flex items-center px-4 text-white font-semibold"
                    style={{ backgroundColor: formData.brand_secondary_color }}
                  >
                    Secondary Color - Accents & Badges
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="content" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Header & Footer Text</CardTitle>
              <CardDescription>Customize text that appears on all PDFs</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>PDF Header Text (Optional)</Label>
                <Input
                  value={formData.pdf_header_text}
                  onChange={(e) => setFormData({ ...formData, pdf_header_text: e.target.value })}
                  placeholder="We Have You Covered!"
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">Short tagline or message below your logo</p>
              </div>

              <div>
                <Label>PDF Footer Text</Label>
                <Input
                  value={formData.pdf_footer_text}
                  onChange={(e) => setFormData({ ...formData, pdf_footer_text: e.target.value })}
                  placeholder="Thank you for your business!"
                  className="mt-2"
                />
                <p className="text-xs text-gray-500 mt-1">Appears at bottom of every page</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Terms & Conditions</CardTitle>
              <CardDescription>Default terms & conditions for estimates and invoices</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={formData.pdf_terms_conditions}
                onChange={(e) => setFormData({ ...formData, pdf_terms_conditions: e.target.value })}
                rows={10}
                placeholder="Enter your default terms & conditions...

Example:
• This includes a 25 year manufacturers Warranty
• All work is backed by 5-year workmanship warranty
• Price valid for 30 days
• 50% deposit required upon acceptance
• Final payment due upon completion"
                className="font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-2">
                💡 Tip: Each estimate can override these terms individually
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="layout" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Logo Settings</CardTitle>
              <CardDescription>Control how your logo appears on PDFs</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Show Logo on PDFs</Label>
                  <p className="text-sm text-gray-500">Display your company logo on estimates and invoices</p>
                </div>
                <Switch
                  checked={formData.pdf_show_logo}
                  onCheckedChange={(checked) => setFormData({ ...formData, pdf_show_logo: checked })}
                />
              </div>

              {formData.pdf_show_logo && (
                <div>
                  <Label>Logo Position</Label>
                  <Select 
                    value={formData.pdf_logo_position} 
                    onValueChange={(value) => setFormData({ ...formData, pdf_logo_position: value })}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="center">Center</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Typography</CardTitle>
              <CardDescription>Choose the font style for your PDFs</CardDescription>
            </CardHeader>
            <CardContent>
              <Label>Font Family</Label>
              <Select 
                value={formData.pdf_font_family} 
                onValueChange={(value) => setFormData({ ...formData, pdf_font_family: value })}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="helvetica">Helvetica (Modern, Clean)</SelectItem>
                  <SelectItem value="times">Times New Roman (Traditional, Formal)</SelectItem>
                  <SelectItem value="courier">Courier (Typewriter Style)</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-r from-green-50 to-blue-50 border-2 border-green-200">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="bg-green-600 rounded-full p-3">
                  <Check className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">Your Branding is Applied Automatically</h3>
                  <p className="text-sm text-gray-700 mb-3">
                    All estimates and invoices generated from the AI Estimator and CRM will use your custom branding.
                  </p>
                  <ul className="text-sm text-gray-700 space-y-1">
                    <li>✅ PDFs use your logo and colors</li>
                    <li>✅ Email templates include your branding</li>
                    <li>✅ Customer portal shows your logo</li>
                    <li>✅ Each company has unique branding</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-3 pt-6 border-t">
        <Button onClick={handlePreview} variant="outline" size="lg">
          <Eye className="w-5 h-5 mr-2" />
          Preview Sample PDF
        </Button>
        <Button onClick={handleSave} disabled={isSaving} size="lg" className="bg-gradient-to-r from-green-600 to-blue-600">
          {isSaving ? 'Saving...' : (
            <>
              <Save className="w-5 h-5 mr-2" />
              Save Branding Settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}