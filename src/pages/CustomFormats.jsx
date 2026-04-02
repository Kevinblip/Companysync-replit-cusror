import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Plus, 
  FileText,
  Edit,
  Trash2,
  Eye,
  Copy,
  Download
} from "lucide-react";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";

export default function CustomFormats() {
  const [user, setUser] = useState(null);
  React.useEffect(() => { base44.auth.me().then(setUser).catch(() => {}); }, []);
  const { company: myCompany } = useCurrentCompany(user);

  const [showDialog, setShowDialog] = useState(false);
  const [editingFormat, setEditingFormat] = useState(null);
  const [filterCategory, setFilterCategory] = useState("all");
  const [previewFormat, setPreviewFormat] = useState(null);
  const [formData, setFormData] = useState({
    format_name: "",
    category: "custom",
    insurance_company: "",
    description: "",
    columns: 7,
    column_headers: ["Description", "Quantity", "Unit", "Unit Price", "Tax", "Total"],
    show_depreciation: false,
    depreciation_label: "Depreciation",
    show_rcv_acv: true,
    rcv_label: "Replacement Cost Value",
    acv_label: "Actual Cash Value",
    show_overhead_profit: false,
    overhead_profit_rate: 10,
    tax_rate: 7.5,
    show_tax_breakdown: true,
    header_logo: true,
    header_text: "",
    footer_text: "",
    show_trade_summary: false,
    show_coverage_summary: false,
    page_size: "letter",
    font_size: "medium",
    color_scheme: "blue",
    is_active: true
  });

  const queryClient = useQueryClient();

  const { data: formats = [] } = useQuery({
    queryKey: ['estimate-formats', myCompany?.id],
    queryFn: async () => {
      // Fetch system defaults (company_id is null)
      const systemFormats = await base44.entities.EstimateFormat.filter({ company_id: null, is_active: true });
      
      // Fetch master company defaults
      let masterFormats = [];
      try {
        masterFormats = await base44.entities.EstimateFormat.filter({ company_id: 'companysync_master_001', is_active: true });
      } catch (e) {
        console.warn('Could not fetch master formats:', e.message);
      }
      
      // Fetch my custom formats
      let myFormats = [];
      if (myCompany?.id && myCompany.id !== 'companysync_master_001') {
        myFormats = await base44.entities.EstimateFormat.filter({ company_id: myCompany.id, is_active: true });
      }
      
      // Merge: My Company > Master Company > System Defaults
      const all = [...myFormats, ...masterFormats, ...systemFormats];
      
      // De-duplicate by name
      const uniqueByName = [];
      const seenNames = new Set();
      for (const f of all) {
        if (!seenNames.has(f.format_name)) {
          uniqueByName.push(f);
          seenNames.add(f.format_name);
        }
      }
      return uniqueByName;
    },
    enabled: true,
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => {
      const payload = {
        ...data,
        company_id: myCompany?.id,
        is_active: true
      };
      // If we are editing an existing format that belongs to us, update it
      if (editingFormat && editingFormat.company_id === myCompany?.id) {
        return base44.entities.EstimateFormat.update(editingFormat.id, payload);
      } 
      // Otherwise (editing a master/system format or creating new), create a new one (clone)
      else {
        const { id, ...createPayload } = payload;
        return base44.entities.EstimateFormat.create(createPayload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate-formats'] });
      handleCloseDialog();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.EstimateFormat.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate-formats'] });
      handleCloseDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.EstimateFormat.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate-formats'] });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: (format) => {
      const newFormat = {
        ...format,
        format_name: `${format.format_name} (Copy)`,
      };
      delete newFormat.id;
      delete newFormat.created_date;
      delete newFormat.updated_date;
      delete newFormat.created_by;
      return base44.entities.EstimateFormat.create(newFormat);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate-formats'] });
    },
  });

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditingFormat(null);
    setFormData({
      format_name: "",
      category: "custom",
      insurance_company: "",
      description: "",
      columns: 7,
      column_headers: ["Description", "Quantity", "Unit", "Unit Price", "Tax", "Total"],
      show_depreciation: false,
      depreciation_label: "Depreciation",
      show_rcv_acv: true,
      rcv_label: "Replacement Cost Value",
      acv_label: "Actual Cash Value",
      show_overhead_profit: false,
      overhead_profit_rate: 10,
      tax_rate: 7.5,
      show_tax_breakdown: true,
      header_logo: true,
      header_text: "",
      footer_text: "",
      show_trade_summary: false,
      show_coverage_summary: false,
      page_size: "letter",
      font_size: "medium",
      color_scheme: "blue",
      is_active: true
    });
  };

  const handleEdit = (format) => {
    setEditingFormat(format);
    setFormData({
      format_name: format.format_name || "",
      category: format.category || "custom",
      insurance_company: format.insurance_company || "",
      description: format.description || "",
      columns: format.columns || 7,
      column_headers: format.column_headers || ["Description", "Quantity", "Unit", "Unit Price", "Tax", "Total"],
      show_depreciation: format.show_depreciation || false,
      depreciation_label: format.depreciation_label || "Depreciation",
      show_rcv_acv: format.show_rcv_acv !== false,
      rcv_label: format.rcv_label || "Replacement Cost Value",
      acv_label: format.acv_label || "Actual Cash Value",
      show_overhead_profit: format.show_overhead_profit || false,
      overhead_profit_rate: format.overhead_profit_rate || 10,
      tax_rate: format.tax_rate || 7.5,
      show_tax_breakdown: format.show_tax_breakdown !== false,
      header_logo: format.header_logo !== false,
      header_text: format.header_text || "",
      footer_text: format.footer_text || "",
      show_trade_summary: format.show_trade_summary || false,
      show_coverage_summary: format.show_coverage_summary || false,
      page_size: format.page_size || "letter",
      font_size: format.font_size || "medium",
      color_scheme: format.color_scheme || "blue",
      is_active: format.is_active !== false
    });
    setShowDialog(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingFormat) {
      updateMutation.mutate({ id: editingFormat.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id) => {
    if (window.confirm('Are you sure you want to delete this format?')) {
      deleteMutation.mutate(id);
    }
  };

  const getCategoryBadge = (category) => {
    const colors = {
      'insurance': 'bg-blue-100 text-blue-700 border-blue-200',
      'contractor': 'bg-green-100 text-green-700 border-green-200',
      'custom': 'bg-purple-100 text-purple-700 border-purple-200'
    };
    return colors[category] || colors.custom;
  };

  const filteredFormats = formats.filter(format => {
    if (filterCategory === "all") return true;
    return format.category === filterCategory;
  });

  const renderPreview = (format) => {
    const colorSchemes = {
      blue: 'bg-blue-600',
      green: 'bg-green-600',
      gray: 'bg-gray-600',
      red: 'bg-red-600'
    };

    return (
      <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
        {/* Header */}
        <div className={`${colorSchemes[format.color_scheme || 'blue']} text-white p-4`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-lg">{format.insurance_company || "Your Company"}</h3>
              <p className="text-sm opacity-90">Construction Estimate</p>
            </div>
            {format.header_logo && (
              <div className="w-16 h-16 bg-white/20 rounded flex items-center justify-center">
                <FileText className="w-8 h-8" />
              </div>
            )}
          </div>
        </div>

        {/* Header Text */}
        {format.header_text && (
          <div className="bg-gray-50 p-3 border-b text-sm text-gray-700">
            {format.header_text}
          </div>
        )}

        {/* Sample Table */}
        <div className="p-4">
          <table className="w-full text-xs">
            <thead className="border-b-2 border-gray-300">
              <tr>
                {(format.column_headers || ["Description", "Qty", "Unit", "Price", "Tax", "Total"]).map((header, idx) => (
                  <th key={idx} className="text-left p-2 font-semibold">{header}</th>
                ))}
                {format.show_depreciation && <th className="text-left p-2 font-semibold">{format.depreciation_label || "Depr."}</th>}
                {format.show_overhead_profit && <th className="text-left p-2 font-semibold">O&P</th>}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="p-2">3-tab comp. shingle roofing</td>
                <td className="p-2">16.01</td>
                <td className="p-2">SQ</td>
                <td className="p-2">$263.77</td>
                <td className="p-2">$153.27</td>
                <td className="p-2">$4,724.40</td>
                {format.show_depreciation && <td className="p-2">$0.00</td>}
                {format.show_overhead_profit && <td className="p-2">$472.44</td>}
              </tr>
              <tr className="border-b">
                <td className="p-2">Roofing felt - 15 lb.</td>
                <td className="p-2">16.01</td>
                <td className="p-2">SQ</td>
                <td className="p-2">$41.18</td>
                <td className="p-2">$10.58</td>
                <td className="p-2">$669.87</td>
                {format.show_depreciation && <td className="p-2">$0.00</td>}
                {format.show_overhead_profit && <td className="p-2">$66.99</td>}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Summary Section */}
        <div className="p-4 bg-gray-50 border-t space-y-2 text-sm">
          {format.show_tax_breakdown && (
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span className="font-semibold">$5,394.27</span>
            </div>
          )}
          {format.show_tax_breakdown && (
            <div className="flex justify-between text-gray-600">
              <span>Tax ({format.tax_rate || 7.5}%):</span>
              <span>$163.85</span>
            </div>
          )}
          {format.show_overhead_profit && (
            <div className="flex justify-between text-gray-600">
              <span>O&P ({format.overhead_profit_rate || 10}%):</span>
              <span>$539.43</span>
            </div>
          )}
          {format.show_rcv_acv && (
            <>
              <div className="flex justify-between font-semibold border-t pt-2">
                <span>{format.rcv_label || "RCV"}:</span>
                <span>$6,097.55</span>
              </div>
              {format.show_depreciation && (
                <div className="flex justify-between text-red-600">
                  <span>Less {format.depreciation_label || "Depreciation"}:</span>
                  <span>($832.50)</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-green-600">
                <span>{format.acv_label || "ACV"}:</span>
                <span>$5,265.05</span>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {format.footer_text && (
          <div className="bg-gray-100 p-3 border-t text-xs text-gray-600">
            {format.footer_text}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Custom Estimate Formats</h1>
          <p className="text-gray-500 mt-1">Create templates for different insurance companies and estimate types</p>
        </div>

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button className="bg-green-600 hover:bg-green-700">
              <Plus className="w-4 h-4 mr-2" />
              Create Custom Format
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingFormat ? 'Edit Format' : 'Create Custom Format'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6">
              <Tabs defaultValue="basic" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="basic">Basic Info</TabsTrigger>
                  <TabsTrigger value="columns">Columns</TabsTrigger>
                  <TabsTrigger value="calculations">Calculations</TabsTrigger>
                  <TabsTrigger value="styling">Styling</TabsTrigger>
                </TabsList>

                <TabsContent value="basic" className="space-y-4">
                  <div>
                    <Label>Format Name *</Label>
                    <Input
                      value={formData.format_name}
                      onChange={(e) => setFormData({...formData, format_name: e.target.value})}
                      required
                      placeholder="e.g., State Farm Standard"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Category</Label>
                      <Select
                        value={formData.category}
                        onValueChange={(value) => setFormData({...formData, category: value})}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="insurance">Insurance</SelectItem>
                          <SelectItem value="contractor">Contractor</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Insurance Company</Label>
                      <Input
                        value={formData.insurance_company}
                        onChange={(e) => setFormData({...formData, insurance_company: e.target.value})}
                        placeholder="e.g., State Farm"
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={formData.description}
                      onChange={(e) => setFormData({...formData, description: e.target.value})}
                      rows={2}
                      placeholder="Describe this format..."
                    />
                  </div>

                  <div>
                    <Label>Header Text</Label>
                    <Textarea
                      value={formData.header_text}
                      onChange={(e) => setFormData({...formData, header_text: e.target.value})}
                      rows={3}
                      placeholder="Disclaimer or header text..."
                    />
                  </div>

                  <div>
                    <Label>Footer Text</Label>
                    <Textarea
                      value={formData.footer_text}
                      onChange={(e) => setFormData({...formData, footer_text: e.target.value})}
                      rows={2}
                      placeholder="Footer text..."
                    />
                  </div>
                </TabsContent>

                <TabsContent value="columns" className="space-y-4">
                  <div>
                    <Label>Number of Columns</Label>
                    <Input
                      type="number"
                      value={formData.columns}
                      onChange={(e) => setFormData({...formData, columns: parseInt(e.target.value)})}
                      min={3}
                      max={15}
                    />
                  </div>

                  <div>
                    <Label>Column Headers (comma-separated)</Label>
                    <Input
                      value={formData.column_headers?.join(", ") || ""}
                      onChange={(e) => setFormData({...formData, column_headers: e.target.value.split(",").map(s => s.trim())})}
                      placeholder="Description, Quantity, Unit, Unit Price, Tax, Total"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="calculations" className="space-y-4">
                  <div className="space-y-3 border-t pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label htmlFor="show_rcv_acv">Show RCV/ACV Calculations</Label>
                        <p className="text-xs text-gray-500">Display replacement cost and actual cash value</p>
                      </div>
                      <Switch
                        id="show_rcv_acv"
                        checked={formData.show_rcv_acv}
                        onCheckedChange={(checked) => setFormData({...formData, show_rcv_acv: checked})}
                      />
                    </div>

                    {formData.show_rcv_acv && (
                      <div className="grid grid-cols-2 gap-4 ml-4">
                        <div>
                          <Label>RCV Label</Label>
                          <Input
                            value={formData.rcv_label}
                            onChange={(e) => setFormData({...formData, rcv_label: e.target.value})}
                            placeholder="Replacement Cost Value"
                          />
                        </div>
                        <div>
                          <Label>ACV Label</Label>
                          <Input
                            value={formData.acv_label}
                            onChange={(e) => setFormData({...formData, acv_label: e.target.value})}
                            placeholder="Actual Cash Value"
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div>
                        <Label htmlFor="show_depreciation">Show Depreciation Column</Label>
                        <p className="text-xs text-gray-500">Add depreciation column to line items</p>
                      </div>
                      <Switch
                        id="show_depreciation"
                        checked={formData.show_depreciation}
                        onCheckedChange={(checked) => setFormData({...formData, show_depreciation: checked})}
                      />
                    </div>

                    {formData.show_depreciation && (
                      <div className="ml-4">
                        <Label>Depreciation Label</Label>
                        <Input
                          value={formData.depreciation_label}
                          onChange={(e) => setFormData({...formData, depreciation_label: e.target.value})}
                          placeholder="Depreciation"
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div>
                        <Label htmlFor="show_overhead_profit">Show Overhead & Profit</Label>
                        <p className="text-xs text-gray-500">Include O&P calculations</p>
                      </div>
                      <Switch
                        id="show_overhead_profit"
                        checked={formData.show_overhead_profit}
                        onCheckedChange={(checked) => setFormData({...formData, show_overhead_profit: checked})}
                      />
                    </div>

                    {formData.show_overhead_profit && (
                      <div className="ml-4">
                        <Label>O&P Rate (%)</Label>
                        <Input
                          type="number"
                          value={formData.overhead_profit_rate}
                          onChange={(e) => setFormData({...formData, overhead_profit_rate: parseFloat(e.target.value)})}
                          placeholder="10"
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div>
                        <Label htmlFor="show_tax_breakdown">Show Tax Breakdown</Label>
                        <p className="text-xs text-gray-500">Display detailed tax calculations</p>
                      </div>
                      <Switch
                        id="show_tax_breakdown"
                        checked={formData.show_tax_breakdown}
                        onCheckedChange={(checked) => setFormData({...formData, show_tax_breakdown: checked})}
                      />
                    </div>

                    {formData.show_tax_breakdown && (
                      <div className="ml-4">
                        <Label>Default Tax Rate (%)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={formData.tax_rate}
                          onChange={(e) => setFormData({...formData, tax_rate: parseFloat(e.target.value)})}
                          placeholder="7.5"
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <Label htmlFor="show_trade_summary">Show Trade Summary</Label>
                      <Switch
                        id="show_trade_summary"
                        checked={formData.show_trade_summary}
                        onCheckedChange={(checked) => setFormData({...formData, show_trade_summary: checked})}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <Label htmlFor="show_coverage_summary">Show Coverage Summary</Label>
                      <Switch
                        id="show_coverage_summary"
                        checked={formData.show_coverage_summary}
                        onCheckedChange={(checked) => setFormData({...formData, show_coverage_summary: checked})}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="styling" className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Page Size</Label>
                      <Select
                        value={formData.page_size}
                        onValueChange={(value) => setFormData({...formData, page_size: value})}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="letter">Letter (8.5" x 11")</SelectItem>
                          <SelectItem value="legal">Legal (8.5" x 14")</SelectItem>
                          <SelectItem value="a4">A4</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Font Size</Label>
                      <Select
                        value={formData.font_size}
                        onValueChange={(value) => setFormData({...formData, font_size: value})}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="small">Small</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="large">Large</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>Color Scheme</Label>
                    <Select
                      value={formData.color_scheme}
                      onValueChange={(value) => setFormData({...formData, color_scheme: value})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="blue">Blue</SelectItem>
                        <SelectItem value="green">Green</SelectItem>
                        <SelectItem value="gray">Gray</SelectItem>
                        <SelectItem value="red">Red</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="header_logo">Include Company Logo</Label>
                    <Switch
                      id="header_logo"
                      checked={formData.header_logo}
                      onCheckedChange={(checked) => setFormData({...formData, header_logo: checked})}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label htmlFor="is_active">Active</Label>
                    <Switch
                      id="is_active"
                      checked={formData.is_active}
                      onCheckedChange={(checked) => setFormData({...formData, is_active: checked})}
                    />
                  </div>
                </TabsContent>
              </Tabs>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-green-600 hover:bg-green-700">
                  {editingFormat ? 'Update Format' : 'Create Format'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="bg-white shadow-md">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <CardTitle>Format Templates</CardTitle>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="insurance">Insurance</SelectItem>
                <SelectItem value="contractor">Contractor</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredFormats.map((format) => (
              <Card key={format.id} className="border-2 hover:shadow-lg transition-shadow">
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">{format.format_name}</h3>
                      {format.insurance_company && (
                        <p className="text-sm text-gray-600">{format.insurance_company}</p>
                      )}
                      <Badge variant="outline" className={`${getCategoryBadge(format.category)} mt-2`}>
                        {format.category}
                      </Badge>
                    </div>
                  </div>

                  {format.description && (
                    <p className="text-sm text-gray-600">{format.description}</p>
                  )}

                  {/* Preview */}
                  <div className="border rounded overflow-hidden">
                    {renderPreview(format)}
                  </div>

                  <div className="flex gap-2 pt-2 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(format)}
                      className="flex-1"
                    >
                      {format.company_id === myCompany?.id ? (
                        <>
                          <Edit className="w-3 h-3 mr-1" />
                          Edit
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 mr-1" />
                          Customize
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => duplicateMutation.mutate(format)}
                      className="flex-1"
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      Duplicate
                    </Button>
                    {format.company_id === myCompany?.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(format.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}

            {filteredFormats.length === 0 && (
              <div className="col-span-2 text-center py-12 text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>No formats found</p>
                <p className="text-sm mt-1">Create your first custom format to get started!</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}