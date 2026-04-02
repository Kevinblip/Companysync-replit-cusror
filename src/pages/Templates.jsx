import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Star,
  Loader2,
  Plus,
  X,
  FileText,
  Package,
  Trash2,
  CheckCircle2,
  Pencil,
  Upload,
  Copy
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";

export default function Templates() {
  const [user, setUser] = useState(null);
  const [creatingDefaults, setCreatingDefaults] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [activeTab, setActiveTab] = useState("formats");
  
  // Edit/Customize State
  const [editingFormat, setEditingFormat] = useState(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [logoFile, setLogoFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  const queryClient = useQueryClient();

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  // Fetch both system formats (company_id is null) and my company's formats
  const { data: estimateFormats = [] } = useQuery({
    queryKey: ['estimate-formats', myCompany?.id],
    queryFn: async () => {
      // Fetch system defaults (company_id is null)
      const systemFormats = await base44.entities.EstimateFormat.filter({ company_id: null, is_active: true });
      
      // Fetch master company defaults if they exist
      let masterFormats = [];
      try {
        masterFormats = await base44.entities.EstimateFormat.filter({ company_id: 'companysync_master_001', is_active: true });
      } catch (e) {
        console.warn('Could not fetch master formats:', e.message);
      }
      
      // Fetch my custom formats if I have a company
      let myFormats = [];
      if (myCompany?.id) {
        myFormats = await base44.entities.EstimateFormat.filter({ company_id: myCompany.id, is_active: true });
      }
      
      // Merge them: My Company > Master Company > System Defaults
      const all = [...myFormats, ...masterFormats, ...systemFormats];
      
      // De-duplicate by name to ensure we only show the "best" version of each template
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
    initialData: [],
    enabled: true // Always try to fetch at least system formats
  });

  const { data: estimateTemplates = [] } = useQuery({
    queryKey: ['estimate-templates', myCompany?.id],
    queryFn: async () => {
      // Fetch master company templates
      let masterTemplates = [];
      try {
        masterTemplates = await base44.entities.EstimateTemplate.filter({ company_id: 'companysync_master_001', is_active: true });
      } catch (e) {}

      // Fetch my templates
      let myTemplates = [];
      if (myCompany?.id) {
        myTemplates = await base44.entities.EstimateTemplate.filter({ company_id: myCompany.id, is_active: true });
      }

      return [...myTemplates, ...masterTemplates];
    },
    enabled: true,
    initialData: [],
  });

  const saveFormatMutation = useMutation({
    mutationFn: async (data) => {
      let logoUrl = data.custom_logo_url;
      
      // Handle Logo Upload
      if (logoFile) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file: logoFile });
        logoUrl = file_url;
      }

      const payload = {
        ...data,
        custom_logo_url: logoUrl,
        company_id: myCompany?.id, // Ensure it's assigned to my company
        is_active: true
      };

      // If we are editing an existing format that belongs to us, update it
      if (data.id && data.company_id === myCompany?.id) {
        return base44.entities.EstimateFormat.update(data.id, payload);
      } 
      // Otherwise (editing a system format or creating new), create a new one (clone)
      else {
        // Remove ID to force create
        const { id, ...createPayload } = payload;
        return base44.entities.EstimateFormat.create(createPayload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['estimate-formats']);
      setIsEditOpen(false);
      setEditingFormat(null);
      setLogoFile(null);
      alert('✅ Template saved successfully!');
    },
    onError: (err) => {
      alert('Error saving template: ' + err.message);
    }
  });

  const handleCreateSampleBundles = async () => {
    let targetCompany = myCompany;

    if (!targetCompany) {
      // If we still have companies array but not myCompany, try to set it from the first one
      const companies = await base44.entities.Company.list("-created_date", 1);
      targetCompany = companies.find(c => c.created_by === user?.email) || companies[0];
      
      if (!targetCompany) {
        alert('⚠️ Please complete company setup first');
        return;
      }
    }

    setCreatingDefaults(true);
    try {
      const templates = [
        {
          company_id: targetCompany.id,
          template_name: "Safeco Standard (Symbility)",
          description: "Safeco/Liberty Mutual/Erie format - Full RCV/ACV with detailed depreciation breakdown.",
          category: "Insurance",
          line_items: [
            {"quantity": 25, "rate": 350, "description": "Remove & Replace Shingles", "unit": "SQ", "code": "RFG 300"},
            {"quantity": 10, "code": "RFG IWS", "rate": 45, "unit": "SQ", "description": "Install Ice & Water Shield"}
          ],
          is_default: false,
          is_active: true
        },
        {
          company_id: targetCompany.id,
          template_name: "State Farm Standard (Age/Life)",
          description: "State Farm AGE/LIFE format - Shows depreciation as Age/Life years (15/30 = 50%).",
          category: "Insurance",
          line_items: [
            {"description": "Remove & Replace Shingles", "quantity": 25, "rate": 350, "unit": "SQ", "code": "RFG 300"},
            {"description": "Install Ice & Water Shield", "quantity": 10, "unit": 'SQ', "code": "RFG IWS", "rate": 45}
          ],
          is_default: false,
          is_active: true
        },
        {
          company_id: targetCompany.id,
          template_name: "Contractor Standard (CompanySync)",
          description: "Direct-to-customer contractor format - Simple Item/Qty/Rate/Amount layout. No depreciation.",
          category: "Retail",
          line_items: [
            {"code": "RFG 300", "quantity": 25, "description": "Remove & Replace Shingles", "rate": 350, "unit": "SQ"},
            {"rate": 45, "quantity": 10, "description": "Install Ice & Water Shield", "unit": "SQ", "code": "RFG IWS"}
          ],
          is_default: false,
          is_active: true
        }
      ];

      await base44.entities.EstimateTemplate.bulkCreate(templates);
      queryClient.invalidateQueries(['estimate-templates']);
      alert('✅ Added 3 sample item templates!');
    } catch (error) {
      alert('❌ Error creating templates: ' + error.message);
    }
    setCreatingDefaults(false);
  };

  const deleteTemplateMutation = useMutation({
    mutationFn: (id) => base44.entities.EstimateTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['estimate-templates']);
    },
  });

  const handleCreateDefaults = async () => {
    // Handle potentially missing company state
    let targetCompany = myCompany;
    
    if (!targetCompany) {
      const companies = await base44.entities.Company.list("-created_date", 1);
      targetCompany = companies.find(c => c.created_by === user?.email) || companies[0];
      
      if (!targetCompany) {
        alert('⚠️ Please complete company setup first');
        return;
      }
    }
    
    setCreatingDefaults(true);
    try {
      // Fetch existing formats for this company to avoid creating duplicates
      const existingFormats = await base44.entities.EstimateFormat.filter({ company_id: targetCompany.id });
      const existingFormatNames = new Set(existingFormats.map(f => f.format_name));

      const defaultFormats = [
        {
          company_id: targetCompany.id,
          format_name: "State Farm Standard (Age/Life)",
          description: "🏦 State Farm AGE/LIFE format - Shows depreciation as Age/Life years (15/30 = 50% off). Auto-calculates ACV from RCV based on material lifespan. Includes O&P, claim details, and adjuster fields.",
          category: "insurance",
          insurance_company: "State Farm",
          color_scheme: "red",
          font_size: "medium",
          page_size: "letter",
          header_logo: true,
          header_text: `${targetCompany.company_name}\nState Farm Preferred Contractor\n${targetCompany.phone || ''}`,
          footer_text: "All work meets State Farm guidelines. Questions? Contact your adjuster.",
          show_rcv_acv: true,
          show_depreciation: true,
          show_age_life: true,
          age_life_presets: {
            shingles: { life_years: 30, default_age: 15 },
            underlayment: { life_years: 20, default_age: 10 },
            felt: { life_years: 20, default_age: 10 },
            flashing: { life_years: 20, default_age: 10 },
            ice_water_shield: { life_years: 20, default_age: 0 }
          },
          rcv_label: "RCV",
          acv_label: "ACV",
          show_overhead_profit: true,
          overhead_profit_rate: 10,
          show_claim_number: true,
          show_insurance_company: true,
          show_adjuster_info: true,
          columns: 9,
          column_headers: ["Code", "Description", "Qty", "Unit", "Unit Price", "RCV", "Age/Life", "Depr %", "ACV"],
          is_active: true
        },
        {
          company_id: targetCompany.id,
          format_name: "Safeco Standard (Symbility)",
          description: "🛡️ Safeco/Liberty Mutual/Erie format - Full RCV/ACV with detailed depreciation breakdown, O&P calculations, tax breakdown, and coverage summary. Used by Symbility estimators.",
          category: "insurance",
          insurance_company: "Safeco",
          color_scheme: "blue",
          font_size: "medium",
          page_size: "letter",
          header_logo: true,
          header_text: `${targetCompany.company_name}\nSafeco/Liberty Mutual/Erie Approved\n${targetCompany.phone || ''} | ${targetCompany.email || ''}`,
          footer_text: "THIS ESTIMATE REPRESENTS OUR CURRENT EVALUATION OF THE COVERED DAMAGES TO THE STRUCTURE.",
          show_rcv_acv: true,
          show_depreciation: true,
          rcv_label: "RCV",
          acv_label: "ACV",
          show_overhead_profit: true,
          overhead_profit_rate: 10,
          show_tax_breakdown: true,
          show_claim_number: true,
          show_insurance_company: true,
          show_coverage_summary: true,
          columns: 9,
          column_headers: ["Description", "Qty", "Unit", "Rate", "RCV", "Depr %", "ACV", "O&P", "Total"],
          is_active: true
        },
        {
          company_id: targetCompany.id,
          format_name: "Contractor Standard (CompanySync)",
          description: "🔨 Direct-to-customer contractor format - Simple Item/Qty/Rate/Amount layout. No insurance calculations or depreciation. Clean, professional look for retail jobs.",
          category: "contractor",
          color_scheme: "green",
          font_size: "medium",
          page_size: "letter",
          header_logo: true,
          header_text: `${targetCompany.company_name}\n${targetCompany.phone || ''} | ${targetCompany.email || ''}`,
          footer_text: "A 5-year workmanship warranty backs all work. If for any reason, the property experiences any leakage around the area that was repaired or replaced, we will gladly fix the problem at no charge.",
          show_rcv_acv: false,
          show_depreciation: false,
          columns: 6,
          column_headers: ["Item", "Qty", "Rate", "Amount", "Tax", "Total"],
          is_active: true
        },
        {
          company_id: targetCompany.id,
          format_name: "State Farm Standard (Xactimate)",
          description: "Standard State Farm insurance estimate format with minimal depreciation display. Used by most State Farm adjusters.",
          category: "insurance",
          insurance_company: "State Farm",
          color_scheme: "blue",
          font_size: "medium",
          page_size: "letter",
          header_logo: true,
          header_text: `${targetCompany.company_name}\nState Farm Preferred Contractor\n${targetCompany.phone || ''}`,
          footer_text: "All work meets State Farm guidelines. Questions? Contact your adjuster.",
          show_rcv_acv: true,
          show_depreciation: true,
          rcv_label: "RCV",
          acv_label: "ACV",
          show_overhead_profit: true,
          overhead_profit_rate: 10,
          show_claim_number: true,
          show_insurance_company: true,
          columns: 9,
          column_headers: ["Code", "Description", "Qty", "Unit", "Unit Price", "RCV", "Depr %", "ACV", "Total"],
          is_active: true
        },
        {
          company_id: targetCompany.id,
          format_name: "Allstate Standard",
          description: "Allstate insurance format with detailed line items, depreciation, and recoverable depreciation calculations.",
          category: "insurance",
          insurance_company: "Allstate",
          color_scheme: "blue",
          font_size: "medium",
          page_size: "letter",
          header_logo: true,
          header_text: `${targetCompany.company_name}\nAllstate Approved Contractor\n${targetCompany.phone || ''} | ${targetCompany.email || ''}`,
          footer_text: "Licensed & Insured. All estimates subject to Allstate approval process.",
          show_rcv_acv: true,
          show_depreciation: true,
          rcv_label: "Replacement Cost",
          acv_label: "Actual Cash Value",
          show_overhead_profit: true,
          overhead_profit_rate: 10,
          show_claim_number: true,
          show_insurance_company: true,
          show_deductible_amount: true,
          columns: 9,
          column_headers: ["Line", "Code", "Description", "Qty", "Unit", "Rate", "RCV", "Deprec", "ACV"],
          is_active: true
        },
        {
          company_id: targetCompany.id,
          format_name: "Farmers Standard",
          description: "Farmers insurance format with trade summary, depreciation schedule, and detailed overhead & profit breakdown.",
          category: "insurance",
          insurance_company: "Farmers",
          color_scheme: "green",
          font_size: "medium",
          page_size: "letter",
          header_logo: true,
          header_text: `${targetCompany.company_name}\nFarmers Insurance Network Contractor\n${targetCompany.phone || ''}`,
          footer_text: "Farmers Insurance Claim Processing • Licensed • Bonded • Insured",
          show_rcv_acv: true,
          show_depreciation: true,
          rcv_label: "RCV",
          acv_label: "ACV",
          show_overhead_profit: true,
          overhead_profit_rate: 10,
          show_trade_summary: true,
          show_claim_number: true,
          show_insurance_company: true,
          columns: 8,
          column_headers: ["Code", "Description", "Quantity", "Unit", "Price", "RCV Total", "Depreciation", "ACV Total"],
          is_active: true
        }
      ];

      const formatsToCreate = defaultFormats.filter(
        (format) => !existingFormatNames.has(format.format_name)
      );
      
      if (formatsToCreate.length > 0) {
        await base44.entities.EstimateFormat.bulkCreate(formatsToCreate);
        queryClient.invalidateQueries(['estimate-formats']);
        alert(`✅ Created ${formatsToCreate.length} professional estimate formats!`);
      } else {
        alert('ℹ️ All default estimate formats already exist.');
      }
    } catch (error) {
      alert('❌ Error creating templates: ' + error.message);
    }
    setCreatingDefaults(false);
  };

  const handleUseTemplate = (format) => {
    // In a real app, this would save to Company settings as "default_format_id"
    alert(`✅ Template "${format.format_name}" selected!\n\nWhen you create a new estimate, select this template from the dropdown.`);
  };

  const handleCustomizeClick = (format, e) => {
    e.stopPropagation();
    setEditingFormat({ ...format });
    setLogoFile(null);
    setIsEditOpen(true);
  };

  const getAccentColor = (colorScheme) => {
    switch(colorScheme) {
      case 'blue': return 'border-blue-500';
      case 'red': return 'border-red-500';
      case 'green': return 'border-green-500';
      case 'gray': return 'border-gray-500';
      default: return 'border-blue-500';
    }
  };

  const getHeaderBg = (colorScheme) => {
    switch(colorScheme) {
      case 'blue': return 'bg-blue-600';
      case 'red': return 'bg-red-600';
      case 'green': return 'bg-green-600';
      case 'gray': return 'bg-gray-600';
      default: return 'bg-blue-600';
    }
  };

  const TemplatePreview = ({ format }) => {
    const isSystem = !format.company_id;
    const isMine = format.company_id === myCompany?.id;

    const getBgColor = () => {
      switch(format.color_scheme) {
        case 'blue': return 'from-blue-50 to-blue-100';
        case 'red': return 'from-red-50 to-red-100';
        case 'green': return 'from-green-50 to-green-100';
        case 'gray': return 'from-gray-50 to-gray-100';
        default: return 'from-blue-50 to-blue-100';
      }
    };

    return (
      <Card 
        className={`cursor-pointer hover:shadow-2xl transition-all duration-300 border-2 ${selectedTemplate?.id === format.id ? 'ring-4 ring-blue-500' : ''}`}
        onClick={() => {
          setSelectedTemplate(format);
          setShowPreview(true);
        }}
      >
        <CardContent className="p-0">
          <div className={`bg-gradient-to-br ${getBgColor()} p-6 min-h-[400px] flex flex-col`}>
            <div className={`border-b-4 ${getAccentColor(format.color_scheme)} pb-3 mb-4`}>
              <div className="flex items-start gap-3">
                {format.header_logo && (
                  <div className="w-12 h-12 bg-white rounded border-2 border-gray-300 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {format.custom_logo_url ? (
                      <img src={format.custom_logo_url} alt="Logo" className="w-full h-full object-contain p-1" />
                    ) : myCompany?.logo_url ? (
                      <img src={myCompany.logo_url} alt="Logo" className="w-full h-full object-contain p-1" />
                    ) : (
                      <span className="text-xs text-gray-400">Logo</span>
                    )}
                  </div>
                )}
                <div className="flex-1">
                  <pre className={`whitespace-pre-wrap font-semibold text-gray-800 ${format.font_size === 'large' ? 'text-base' : format.font_size === 'small' ? 'text-xs' : 'text-sm'}`}>
                    {format.header_text?.split('\n').slice(0, 3).join('\n')}
                  </pre>
                </div>
              </div>
            </div>

            <div className="bg-white/80 rounded p-3 mb-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div><strong>Customer:</strong> John Smith</div>
                <div><strong>Date:</strong> {new Date().toLocaleDateString()}</div>
                <div><strong>Address:</strong> 123 Main St</div>
                <div><strong>Estimate #:</strong> EST-1001</div>
              </div>
            </div>

            <div className="bg-white rounded flex-1 overflow-hidden">
              <div className={`${getHeaderBg(format.color_scheme)} text-white text-xs font-semibold p-2 grid gap-1`} style={{ gridTemplateColumns: `repeat(${format.columns || 5}, minmax(0, 1fr))` }}>
                {format.column_headers?.slice(0, 5).map((header, i) => (
                  <div key={i} className="truncate">{header}</div>
                ))}
              </div>
              <div className="p-3 space-y-2">
                <div className="text-xs text-gray-500 italic">Sample line items...</div>
                <div className="text-xs text-gray-400">Remove & Replace Shingles (25 SQ)</div>
                <div className="text-xs text-gray-400">Install Ice & Water Shield (10 SQ)</div>
              </div>
            </div>

            <div className={`border-t-2 ${getAccentColor(format.color_scheme)} pt-2 mt-3`}>
              <p className="text-xs text-gray-700 line-clamp-2">{format.footer_text}</p>
            </div>
          </div>

          <div className="p-4 bg-white border-t-2">
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-bold text-lg">{format.format_name}</h3>
              <div className="flex gap-1">
                {format.category === 'insurance' && (
                  <Badge className="bg-purple-100 text-purple-700">Insurance</Badge>
                )}
                <Badge className={format.color_scheme === 'blue' ? 'bg-blue-100 text-blue-700' : format.color_scheme === 'red' ? 'bg-red-100 text-red-700' : format.color_scheme === 'green' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}>
                  {format.color_scheme}
                </Badge>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-3 line-clamp-2">{format.description}</p>
            <div className="flex gap-2">
              <Button 
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUseTemplate(format);
                }}
              >
                Use
              </Button>
              <Button
                variant="outline"
                className="flex-1 border-blue-200 hover:bg-blue-50 text-blue-700"
                onClick={(e) => handleCustomizeClick(format, e)}
              >
                {isMine ? <><Pencil className="w-3 h-3 mr-2" /> Edit</> : <><Copy className="w-3 h-3 mr-2" /> Customize</>}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Templates & Macros</h1>
          <p className="text-gray-500 mt-1">Manage estimate layouts and pre-built item bundles</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start border-b rounded-none bg-transparent p-0 h-auto mb-6">
          <TabsTrigger
            value="formats"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent px-6 py-2"
          >
            <FileText className="w-4 h-4 mr-2" />
            Estimate Layouts
          </TabsTrigger>
          <TabsTrigger
            value="bundles"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-purple-600 data-[state=active]:bg-transparent px-6 py-2"
          >
            <Package className="w-4 h-4 mr-2" />
            Item Bundles (Macros)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="formats" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Document Formats</h2>
            {estimateFormats.length === 0 && (
              <Button
                onClick={handleCreateDefaults}
                disabled={creatingDefaults || !myCompany}
                className="bg-gradient-to-r from-blue-600 to-indigo-600"
              >
                {creatingDefaults ? 'Creating...' : 'Generate Standard Formats'}
              </Button>
            )}
          </div>

          {estimateFormats.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <div className="w-24 h-24 bg-gray-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
                  <FileText className="w-12 h-12 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No formats yet</h3>
                <p className="text-gray-500 mb-4">Create professional estimate templates to style your PDF exports</p>
                <Button onClick={handleCreateDefaults} disabled={creatingDefaults || !myCompany}>
                  Create Standard Formats
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {estimateFormats.map(format => (
                <TemplatePreview key={format.id} format={format} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="bundles" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Item Bundles (Macros)</h2>
            <Button
              onClick={handleCreateSampleBundles}
              disabled={creatingDefaults || !myCompany}
              className="bg-gradient-to-r from-purple-600 to-pink-600 text-white"
            >
              {creatingDefaults ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Sample Bundles
                </>
              )}
            </Button>
          </div>

          {estimateTemplates.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <div className="w-24 h-24 bg-gray-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
                  <Package className="w-12 h-12 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No item bundles yet</h3>
                <p className="text-gray-500 mb-4">Item bundles (macros) allow you to add groups of items to an estimate in one click.</p>
                <Button onClick={handleCreateSampleBundles} disabled={creatingDefaults || !myCompany}>
                  Add Sample Bundles
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {estimateTemplates.map(template => (
                <Card key={template.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="flex flex-row items-start justify-between pb-2">
                    <div>
                      <CardTitle className="text-lg font-bold">{template.template_name}</CardTitle>
                      <Badge variant="outline" className="mt-1 capitalize">{template.category}</Badge>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={() => {
                        if(confirm('Delete this template?')) deleteTemplateMutation.mutate(template.id);
                      }}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-600 mb-4 h-10 line-clamp-2">{template.description}</p>
                    
                    <div className="bg-gray-50 rounded-lg p-3 mb-4 space-y-2">
                      <div className="text-xs font-semibold text-gray-500 uppercase">Includes {template.line_items?.length || 0} Items</div>
                      {template.line_items?.slice(0, 3).map((item, i) => (
                        <div key={i} className="text-sm flex justify-between">
                          <span className="truncate flex-1 pr-2">• {item.description}</span>
                          <span className="text-gray-500">{item.quantity} {item.unit}</span>
                        </div>
                      ))}
                      {template.line_items?.length > 3 && (
                        <div className="text-xs text-blue-600 italic">+ {template.line_items.length - 3} more items</div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-2 rounded">
                      <CheckCircle2 className="w-4 h-4" />
                      Ready to use in Estimates
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* EDIT FORMAT DIALOG */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingFormat?.company_id ? 'Edit Template' : 'Customize System Template'}
            </DialogTitle>
          </DialogHeader>
          
          {editingFormat && (
            <div className="space-y-6 py-4">
              <div className="space-y-2">
                <Label>Template Name</Label>
                <Input 
                  value={editingFormat.format_name} 
                  onChange={(e) => setEditingFormat({...editingFormat, format_name: e.target.value})}
                />
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea 
                  value={editingFormat.description} 
                  onChange={(e) => setEditingFormat({...editingFormat, description: e.target.value})}
                  className="h-20"
                />
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4 border p-4 rounded-lg">
                  <div className="flex items-center justify-between">
                    <Label>Header Logo</Label>
                    <Switch 
                      checked={editingFormat.header_logo}
                      onCheckedChange={(c) => setEditingFormat({...editingFormat, header_logo: c})}
                    />
                  </div>
                  
                  {editingFormat.header_logo && (
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-500">Custom Logo (Overrides Company Default)</Label>
                      <div className="flex items-center gap-4">
                        {(logoFile || editingFormat.custom_logo_url) && (
                          <div className="w-16 h-16 border rounded flex items-center justify-center p-1 bg-gray-50">
                            <img 
                              src={logoFile ? URL.createObjectURL(logoFile) : editingFormat.custom_logo_url} 
                              alt="Preview" 
                              className="w-full h-full object-contain"
                            />
                          </div>
                        )}
                        <div className="flex-1">
                          <Input 
                            type="file" 
                            accept="image/*"
                            onChange={(e) => setLogoFile(e.target.files[0])}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4 border p-4 rounded-lg">
                  <div className="space-y-2">
                    <Label>Color Scheme</Label>
                    <div className="flex gap-2">
                      {['blue', 'red', 'green', 'gray'].map(color => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setEditingFormat({...editingFormat, color_scheme: color})}
                          className={`w-8 h-8 rounded-full border-2 ${editingFormat.color_scheme === color ? 'ring-2 ring-offset-2 ring-black border-transparent' : 'border-gray-200'}`}
                          style={{ backgroundColor: color === 'gray' ? '#6b7280' : color === 'blue' ? '#3b82f6' : color === 'red' ? '#ef4444' : '#22c55e' }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Header Text</Label>
                <Textarea 
                  value={editingFormat.header_text} 
                  onChange={(e) => setEditingFormat({...editingFormat, header_text: e.target.value})}
                  className="h-24 font-mono text-sm"
                  placeholder="Enter your company info..."
                />
                <p className="text-xs text-gray-500">This text appears at the top of the estimate.</p>
              </div>

              <div className="space-y-2">
                <Label>Footer Text</Label>
                <Textarea 
                  value={editingFormat.footer_text} 
                  onChange={(e) => setEditingFormat({...editingFormat, footer_text: e.target.value})}
                  className="h-24"
                  placeholder="Terms, conditions, or thank you message..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button variant="ghost" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                <Button 
                  onClick={() => saveFormatMutation.mutate(editingFormat)}
                  disabled={saveFormatMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {saveFormatMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                  ) : (
                    'Save Template'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* FULL PREVIEW DIALOG WITH ACTUAL TEMPLATE LAYOUT */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-2xl">{selectedTemplate?.format_name} ({selectedTemplate?.insurance_company || selectedTemplate?.category})</DialogTitle>
                <p className="text-sm text-gray-500 mt-1">{selectedTemplate?.description}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowPreview(false)}>
                <X className="w-5 h-5" />
              </Button>
            </div>
          </DialogHeader>

          {selectedTemplate && (
            <div className="space-y-4">
              {/* FULL SIZE ESTIMATE PREVIEW */}
              {selectedTemplate.format_name?.toLowerCase().includes('xactimate') ? (
                <div className="border rounded-lg bg-white shadow-lg overflow-hidden" style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '13px', color: '#1a1a1a' }}>
                  {/* Letterhead */}
                  <div className="text-center px-8 py-5 border-b border-gray-300">
                    {(selectedTemplate.custom_logo_url || myCompany?.logo_url) && (
                      <img src={selectedTemplate.custom_logo_url || myCompany.logo_url} alt="Logo" className="max-h-12 max-w-48 mx-auto mb-2 object-contain" />
                    )}
                    <div className="font-bold text-base">{myCompany?.company_name || 'Your Insurance Claims Network'}</div>
                    {(myCompany?.address || myCompany?.city) && (
                      <div className="text-xs text-gray-600 mt-0.5">
                        {[myCompany?.address, myCompany?.city, myCompany?.state, myCompany?.zip].filter(Boolean).join(', ')}
                      </div>
                    )}
                    {myCompany?.phone && <div className="text-xs text-gray-600">{myCompany.phone}</div>}
                    <div className="text-xs text-gray-500 mt-0.5">{new Date().toLocaleDateString()} {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                  {/* Insured / Claim two-column grid */}
                  <div className="grid grid-cols-2 border-b border-gray-300 text-sm">
                    <div className="px-6 py-4 space-y-1 border-r border-gray-300">
                      {[['Insured','Jane Doe'],['Property','11720 McGowan Ave'],['','Cleveland, OH 44135'],['Home','(216) 298-2899'],['Type of Loss','Wind'],['Deductible','$1,449.00'],['Date of Loss','3/13/2026'],['Date Inspected','3/19/2026']].map(([label,val],i) => (
                        <div key={i} className="flex gap-2">
                          <span className={`whitespace-nowrap ${label ? 'font-bold min-w-[110px]' : 'min-w-[110px]'}`}>{label ? `${label}:` : ''}</span>
                          <span className="text-gray-700">{val}</span>
                        </div>
                      ))}
                    </div>
                    <div className="px-6 py-4 space-y-1">
                      {[['Estimate','EST-1001'],['Claim Number','3597V890B'],['Policy Number','35GZE6648'],['Price List','OHCL28_MAR26'],['','Restoration/Service/Remodel'],['Date',new Date().toLocaleDateString()]].map(([label,val],i) => (
                        <div key={i} className="flex gap-2">
                          <span className={`whitespace-nowrap ${label ? 'font-bold min-w-[100px]' : 'min-w-[100px]'}`}>{label ? `${label}:` : ''}</span>
                          <span className="text-gray-700">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Summary for Dwelling */}
                  <div className="px-8 py-5 border-b border-gray-200">
                    <div className="font-bold text-sm text-center underline mb-3">Summary for Dwelling</div>
                    <div className="max-w-xs mx-auto space-y-1 text-sm">
                      {[['Line Item Total','5,496.18'],['Material Sales Tax','119.05'],['Replacement Cost Value','5,615.23'],['Less Deductible','(1,449.00)']].map(([label,val]) => (
                        <div key={label} className="flex justify-between"><span>{label}</span><span>{val}</span></div>
                      ))}
                      <div className="flex justify-between font-bold border-t border-gray-500 pt-1"><span>Net Payment</span><span>$4,166.23</span></div>
                    </div>
                  </div>
                  {/* Line items — Xactimate columns: DESCRIPTION | QUANTITY | UNIT PRICE | TAX | RCV */}
                  <div className="px-8 py-4">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr style={{ borderTop: '2px solid #374151', borderBottom: '2px solid #374151' }}>
                          <th className="py-2 pr-4 text-left font-bold">DESCRIPTION</th>
                          <th className="py-2 px-2 text-right font-bold whitespace-nowrap">QUANTITY</th>
                          <th className="py-2 px-2 text-right font-bold whitespace-nowrap">UNIT PRICE</th>
                          <th className="py-2 px-2 text-right font-bold">TAX</th>
                          <th className="py-2 pl-2 text-right font-bold">RCV</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ['Remove 3 tab - 25 yr. - comp. shingle roofing','8.74 SQ','76.65','0.00','669.92'],
                          ['3 tab - 25 yr. - comp. shingle roofing - w/out felt','9.00 SQ','263.37','79.21','2,449.54'],
                          ['R&R Hip / Ridge cap - cut from 3 tab shingles','35.07 LF','8.85','3.73','314.10'],
                          ['Roofing felt - 15 lb.','6.82 SQ','41.10','4.50','284.80'],
                          ['Ice & water barrier','192.00 SF','2.02','8.29','396.13'],
                          ['Asphalt starter - universal starter course','126.69 LF','2.21','6.59','286.57'],
                          ['R&R Drip edge','126.69 LF','3.63','11.35','471.23'],
                          ['Dumpster load - Approx. 20 yards, 4 tons','1.00 EA','589.00','0.00','589.00'],
                        ].map(([desc,qty,price,tax,rcv],i) => (
                          <tr key={i} className={i%2===0?'bg-white':'bg-gray-50'}>
                            <td className="py-1.5 pr-4 border-b border-gray-200">{i+1}. {desc}</td>
                            <td className="py-1.5 px-2 border-b border-gray-200 text-right whitespace-nowrap">{qty}</td>
                            <td className="py-1.5 px-2 border-b border-gray-200 text-right">{price}</td>
                            <td className="py-1.5 px-2 border-b border-gray-200 text-right">{tax}</td>
                            <td className="py-1.5 pl-2 border-b border-gray-200 text-right font-semibold">{rcv}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: '2px solid #374151' }}>
                          <td colSpan={3} className="py-2 pr-2 text-right font-bold">Totals:</td>
                          <td className="py-2 px-2 text-right font-bold">119.05</td>
                          <td className="py-2 pl-2 text-right font-bold">5,615.23</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {/* Footer disclaimer */}
                  <div className="px-8 pb-5 pt-2 border-t border-gray-200 text-center font-bold" style={{ fontSize: '11px' }}>
                    ALL AMOUNTS PAYABLE ARE SUBJECT TO THE TERMS, CONDITIONS AND LIMITS OF YOUR POLICY.
                  </div>
                </div>
              ) : (
              <div className="border-2 rounded-lg p-8 bg-white shadow-lg">
                {/* Header Section */}
                <div className={`border-b-4 ${getAccentColor(selectedTemplate.color_scheme)} pb-4 mb-6`}>
                  <div className="flex items-start gap-4">
                    {selectedTemplate.header_logo && (
                      <div className="w-24 h-24 bg-white rounded border-2 border-gray-300 flex items-center justify-center flex-shrink-0 overflow-hidden p-2">
                        {selectedTemplate.custom_logo_url ? (
                          <img src={selectedTemplate.custom_logo_url} alt="Custom Logo" className="w-full h-full object-contain" />
                        ) : myCompany?.logo_url ? (
                          <img src={myCompany.logo_url} alt="Company Logo" className="w-full h-full object-contain" />
                        ) : (
                          <span className="text-sm text-gray-400">Your Logo</span>
                        )}
                      </div>
                    )}
                    <div className="flex-1">
                      {selectedTemplate.header_text ? (
                        <pre className={`whitespace-pre-wrap font-sans text-gray-800 ${selectedTemplate.font_size === 'large' ? 'text-lg' : selectedTemplate.font_size === 'small' ? 'text-sm' : 'text-base'}`}>
                          {selectedTemplate.header_text}
                        </pre>
                      ) : (
                        <>
                          <h2 className="text-2xl font-bold text-gray-900 mb-1">{myCompany?.company_name || 'Your Company Name'}</h2>
                          <div className="text-sm text-gray-700 space-y-0.5">
                            {myCompany?.address && <div>{myCompany.address}</div>}
                            {(myCompany?.city || myCompany?.state || myCompany?.zip) && (
                              <div>{myCompany.city}{myCompany.city && myCompany.state ? ', ' : ''}{myCompany.state} {myCompany.zip}</div>
                            )}
                            <div className="flex gap-4 mt-1">
                              {myCompany?.phone && <div>📞 {myCompany.phone}</div>}
                              {myCompany?.email && <div>✉️ {myCompany.email}</div>}
                            </div>
                            {myCompany?.website && <div>🌐 {myCompany.website}</div>}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Customer & Estimate Info */}
                <div className="grid grid-cols-2 gap-6 mb-6 p-4 bg-gray-50 rounded-lg">
                  <div>
                    <h3 className="font-bold text-sm text-gray-700 mb-2">CUSTOMER INFORMATION</h3>
                    <div className="space-y-1 text-sm">
                      <div><strong>Name:</strong> John Smith</div>
                      <div><strong>Address:</strong> 123 Main Street, Cleveland, OH 44101</div>
                      <div><strong>Phone:</strong> (555) 123-4567</div>
                      <div><strong>Email:</strong> john.smith@email.com</div>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-gray-700 mb-2">ESTIMATE DETAILS</h3>
                    <div className="space-y-1 text-sm">
                      <div><strong>Estimate #:</strong> EST-1001</div>
                      <div><strong>Date:</strong> {new Date().toLocaleDateString()}</div>
                      <div><strong>Valid Until:</strong> {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}</div>
                      {selectedTemplate.show_claim_number && (
                        <div><strong>Claim #:</strong> CLM-2024-001</div>
                      )}
                      {selectedTemplate.show_insurance_company && (
                        <div><strong>Insurance:</strong> {selectedTemplate.insurance_company || 'N/A'}</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Line Items Table */}
                <div className="mb-6">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className={`${getHeaderBg(selectedTemplate.color_scheme)} text-white`}>
                        {selectedTemplate.column_headers?.map((header, i) => (
                          <th key={i} className="border border-gray-300 p-3 text-left text-sm font-semibold">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {/* Sample Line Items */}
                      <tr className="border-b border-gray-200">
                        <td className="border border-gray-300 p-3 text-sm">RFG R&R</td>
                        <td className="border border-gray-300 p-3 text-sm">Remove & Replace Shingles</td>
                        <td className="border border-gray-300 p-3 text-sm text-right">25</td>
                        <td className="border border-gray-300 p-3 text-sm">SQ</td>
                        <td className="border border-gray-300 p-3 text-sm text-right">$125.00</td>
                        {selectedTemplate.show_rcv_acv && (
                          <>
                            <td className="border border-gray-300 p-3 text-sm text-right font-semibold">$3,125.00</td>
                            {selectedTemplate.show_depreciation && (
                              <td className="border border-gray-300 p-3 text-sm text-right">$312.50</td>
                            )}
                            <td className="border border-gray-300 p-3 text-sm text-right font-semibold">$2,812.50</td>
                          </>
                        )}
                        {!selectedTemplate.show_rcv_acv && (
                          <td className="border border-gray-300 p-3 text-sm text-right font-semibold">$3,125.00</td>
                        )}
                      </tr>
                      <tr className="border-b border-gray-200">
                        <td className="border border-gray-300 p-3 text-sm">RFG IWS</td>
                        <td className="border border-gray-300 p-3 text-sm">Install Ice & Water Shield</td>
                        <td className="border border-gray-300 p-3 text-sm text-right">10</td>
                        <td className="border border-gray-300 p-3 text-sm">SQ</td>
                        <td className="border border-gray-300 p-3 text-sm text-right">$35.00</td>
                        {selectedTemplate.show_rcv_acv && (
                          <>
                            <td className="border border-gray-300 p-3 text-sm text-right font-semibold">$350.00</td>
                            {selectedTemplate.show_depreciation && (
                              <td className="border border-gray-300 p-3 text-sm text-right">$0.00</td>
                            )}
                            <td className="border border-gray-300 p-3 text-sm text-right font-semibold">$350.00</td>
                          </>
                        )}
                        {!selectedTemplate.show_rcv_acv && (
                          <td className="border border-gray-300 p-3 text-sm text-right font-semibold">$350.00</td>
                        )}
                      </tr>
                      <tr className="border-b border-gray-200">
                        <td className="border border-gray-300 p-3 text-sm">RFG UL</td>
                        <td className="border border-gray-300 p-3 text-sm">Install Underlayment</td>
                        <td className="border border-gray-300 p-3 text-sm text-right">25</td>
                        <td className="border border-gray-300 p-3 text-sm">SQ</td>
                        <td className="border border-gray-300 p-3 text-sm text-right">$18.00</td>
                        {selectedTemplate.show_rcv_acv && (
                          <>
                            <td className="border border-gray-300 p-3 text-sm text-right font-semibold">$450.00</td>
                            {selectedTemplate.show_depreciation && (
                              <td className="border border-gray-300 p-3 text-sm text-right">$45.00</td>
                            )}
                            <td className="border border-gray-300 p-3 text-sm text-right font-semibold">$405.00</td>
                          </>
                        )}
                        {!selectedTemplate.show_rcv_acv && (
                          <td className="border border-gray-300 p-3 text-sm text-right font-semibold">$450.00</td>
                        )}
                      </tr>
                    </tbody>
                    <tfoot className={`${getHeaderBg(selectedTemplate.color_scheme)} text-white`}>
                      <tr>
                        <td colSpan={selectedTemplate.show_rcv_acv ? (selectedTemplate.show_depreciation ? 5 : 4) : 4} className="border border-gray-300 p-3 text-right font-bold">
                          SUBTOTAL:
                        </td>
                        <td className="border border-gray-300 p-3 text-right font-bold">
                          {selectedTemplate.show_rcv_acv ? '$3,925.00' : '$3,925.00'}
                        </td>
                        {selectedTemplate.show_rcv_acv && selectedTemplate.show_depreciation && (
                          <>
                            <td className="border border-gray-300 p-3 text-right font-bold">$357.50</td>
                            <td className="border border-gray-300 p-3 text-right font-bold">$3,567.50</td>
                          </>
                        )}
                        {selectedTemplate.show_rcv_acv && !selectedTemplate.show_depreciation && (
                          <td className="border border-gray-300 p-3 text-right font-bold">$3,567.50</td>
                        )}
                      </tr>
                      {selectedTemplate.show_overhead_profit && (
                        <tr>
                          <td colSpan={selectedTemplate.show_rcv_acv ? (selectedTemplate.show_depreciation ? 5 : 4) : 4} className="border border-gray-300 p-3 text-right font-bold">
                            O&P ({selectedTemplate.overhead_profit_rate}%):
                          </td>
                          <td className="border border-gray-300 p-3 text-right font-bold" colSpan={selectedTemplate.show_depreciation ? 3 : 2}>
                            $392.50
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td colSpan={selectedTemplate.show_rcv_acv ? (selectedTemplate.show_depreciation ? 5 : 4) : 4} className="border border-gray-300 p-3 text-right font-bold text-lg">
                          TOTAL:
                        </td>
                        <td className="border border-gray-300 p-3 text-right font-bold text-lg" colSpan={selectedTemplate.show_depreciation ? 3 : 2}>
                          ${selectedTemplate.show_overhead_profit ? '4,317.50' : '3,925.00'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Footer Section */}
                <div className={`border-t-4 ${getAccentColor(selectedTemplate.color_scheme)} pt-4`}>
                  <p className="text-sm text-gray-700">{selectedTemplate.footer_text}</p>
                </div>
              </div>
              )}

              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setShowPreview(false)}>
                  Close
                </Button>
                <Button
                  variant="outline"
                  className="border-blue-200 hover:bg-blue-50 text-blue-700"
                  onClick={(e) => {
                    setShowPreview(false);
                    handleCustomizeClick(selectedTemplate, e);
                  }}
                >
                  {selectedTemplate.company_id === myCompany?.id ? <><Pencil className="w-4 h-4 mr-2" /> Edit Template</> : <><Copy className="w-4 h-4 mr-2" /> Customize Copy</>}
                </Button>
                <Button 
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => {
                    handleUseTemplate(selectedTemplate);
                    setShowPreview(false);
                  }}
                >
                  Use This Template
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}