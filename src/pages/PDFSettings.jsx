import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Save, FileText } from "lucide-react";

export default function PDFSettings() {
  const [user, setUser] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const myCompany = companies.find(c => c.created_by === user?.email);

  const [pdfSettings, setPdfSettings] = useState({
    pdf_font: 'Helvetica',
    default_font_size: 10,
    swap_company_details: false,
    table_heading_color: '#1f2937',
    table_heading_text_color: '#ffffff',
    company_logo_url: '',
    logo_width: 150,
    show_status_on_pdf: true,
    show_pay_link_on_pdf: true,
    show_invoice_payments: true,
    show_page_number: true,
  });

  useEffect(() => {
    if (myCompany?.settings?.pdf) {
      setPdfSettings({ ...pdfSettings, ...myCompany.settings.pdf });
    }
  }, [myCompany]);

  const updateMutation = useMutation({
    mutationFn: (data) => {
      const currentSettings = myCompany.settings || {};
      return base44.entities.Company.update(myCompany.id, { 
        settings: { ...currentSettings, pdf: data } 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      alert('✅ PDF Settings saved!');
    },
  });

  const handleSave = () => {
    updateMutation.mutate(pdfSettings);
  };

  if (!myCompany) return <div className="p-6">Loading...</div>;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">PDF Settings</h1>
          <p className="text-gray-500 mt-1">Customize PDF appearance for estimates, invoices, and proposals</p>
        </div>
        <Button onClick={handleSave} className="bg-green-600 hover:bg-green-700">
          <Save className="w-4 h-4 mr-2" />
          Save Settings
        </Button>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="signature">Signature</TabsTrigger>
          <TabsTrigger value="formats">Document Formats</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>PDF Appearance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>PDF Font</Label>
                  <Select value={pdfSettings.pdf_font} onValueChange={(v) => setPdfSettings({...pdfSettings, pdf_font: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Helvetica">Helvetica</SelectItem>
                      <SelectItem value="Times">Times</SelectItem>
                      <SelectItem value="Courier">Courier</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Default Font Size</Label>
                  <Input
                    type="number"
                    value={pdfSettings.default_font_size}
                    onChange={(e) => setPdfSettings({...pdfSettings, default_font_size: parseInt(e.target.value)})}
                  />
                </div>
              </div>

              <div>
                <Label>Table Heading Background Color</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={pdfSettings.table_heading_color}
                    onChange={(e) => setPdfSettings({...pdfSettings, table_heading_color: e.target.value})}
                    className="w-20"
                  />
                  <Input
                    value={pdfSettings.table_heading_color}
                    onChange={(e) => setPdfSettings({...pdfSettings, table_heading_color: e.target.value})}
                  />
                </div>
              </div>

              <div>
                <Label>Table Heading Text Color</Label>
                <div className="flex gap-2">
                  <Input
                    type="color"
                    value={pdfSettings.table_heading_text_color}
                    onChange={(e) => setPdfSettings({...pdfSettings, table_heading_text_color: e.target.value})}
                    className="w-20"
                  />
                  <Input
                    value={pdfSettings.table_heading_text_color}
                    onChange={(e) => setPdfSettings({...pdfSettings, table_heading_text_color: e.target.value})}
                  />
                </div>
              </div>

              <div>
                <Label>Logo Width (px)</Label>
                <Input
                  type="number"
                  value={pdfSettings.logo_width}
                  onChange={(e) => setPdfSettings({...pdfSettings, logo_width: parseInt(e.target.value)})}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>PDF Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between py-3">
                <div>
                  <Label className="text-base">Swap Company/Customer Details</Label>
                  <p className="text-sm text-gray-500">Company details on right, customer on left</p>
                </div>
                <Switch
                  checked={pdfSettings.swap_company_details}
                  onCheckedChange={(v) => setPdfSettings({...pdfSettings, swap_company_details: v})}
                />
              </div>

              <div className="flex items-center justify-between py-3 border-t">
                <div>
                  <Label className="text-base">Show Invoice/Estimate/Credit Note status on PDF</Label>
                </div>
                <Switch
                  checked={pdfSettings.show_status_on_pdf}
                  onCheckedChange={(v) => setPdfSettings({...pdfSettings, show_status_on_pdf: v})}
                />
              </div>

              <div className="flex items-center justify-between py-3 border-t">
                <div>
                  <Label className="text-base">Show Pay Invoice link on PDF</Label>
                  <p className="text-sm text-gray-500">Only if invoice status is Cancelled</p>
                </div>
                <Switch
                  checked={pdfSettings.show_pay_link_on_pdf}
                  onCheckedChange={(v) => setPdfSettings({...pdfSettings, show_pay_link_on_pdf: v})}
                />
              </div>

              <div className="flex items-center justify-between py-3 border-t">
                <div>
                  <Label className="text-base">Show Invoice Payments (transactions) on PDF</Label>
                </div>
                <Switch
                  checked={pdfSettings.show_invoice_payments}
                  onCheckedChange={(v) => setPdfSettings({...pdfSettings, show_invoice_payments: v})}
                />
              </div>

              <div className="flex items-center justify-between py-3 border-t">
                <div>
                  <Label className="text-base">Show Page Number on PDF</Label>
                </div>
                <Switch
                  checked={pdfSettings.show_page_number}
                  onCheckedChange={(v) => setPdfSettings({...pdfSettings, show_page_number: v})}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="signature">
          <Card>
            <CardHeader>
              <CardTitle>Digital Signature</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-500">Digital signature settings coming soon...</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="formats">
          <Card>
            <CardHeader>
              <CardTitle>Document Formats</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-500">Custom document format settings available in Custom Formats page</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}