import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { BulkDeleteButton } from "@/components/BulkDeleteControls";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Search, Star, StarOff, Plus, Download, Upload, Trash2, ChevronLeft, ChevronRight, Check, Plug, Sparkles, Filter, X, Code2, Edit, FileSpreadsheet, Loader2, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { useToast } from "@/components/ui/use-toast";
import { matchesPriceListSearch } from "@/lib/priceListUtils";
import { loadCompanyPriceCatalog } from "@/lib/loadCompanyPriceCatalog";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";

export default function Items() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [itemsPerPage, setItemsPerPage] = useState("100");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedItems, setSelectedItems] = useState([]);
  const [activeTab, setActiveTab] = useState("all");
  const [showCodeDialog, setShowCodeDialog] = useState(false);
  const [editingCode, setEditingCode] = useState(null);
  const [codeFormData, setCodeFormData] = useState({
    code: "",
    description: "",
    category: "Other"
  });
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const [isImportingCodes, setIsImportingCodes] = useState(false);
  const [isAddingSamples, setIsAddingSamples] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const { toast } = useToast();
  const fileInputRef = React.useRef(null);
  const codesCsvInputRef = React.useRef(null);

  const queryClient = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => base44.auth.me(),
    initialData: null,
  });

  // Use the same active-company resolution as the app shell. Items must follow
  // the selected/impersonated tenant, not whichever staff profile happens to
  // appear first.
  const { company: myCompany } = useCurrentCompany(user);

  const { data: allItems = [] } = useQuery({
    queryKey: ['price-list-items', myCompany?.id],
    queryFn: () => myCompany?.id
      ? loadCompanyPriceCatalog(base44.entities.PriceListItem, myCompany.id)
      : [],
    enabled: !!myCompany?.id,
  });

  const { data: buildingCodes = [] } = useQuery({
    queryKey: ['building-codes', myCompany?.id],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      return base44.entities.BuildingCode.filter({ company_id: myCompany.id }, "-created_date", 1000);
    },
    enabled: !!myCompany?.id,
  });

  const { data: priceListBackups = [] } = useQuery({
    queryKey: ['price-list-backups', myCompany?.id],
    queryFn: () => myCompany?.id
      ? base44.entities.PriceListBackup.filter({ company_id: myCompany.id }, "-created_date", 10)
      : [],
    enabled: !!myCompany?.id,
    staleTime: 30000,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }) =>
      base44.entities.PriceListItem.update(id, { is_active: !isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
    },
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: ({ id, isFavorite }) =>
      base44.entities.PriceListItem.update(id, { is_favorite: !isFavorite }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.PriceListItem.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
    },
  });

  const createItemMutation = useMutation({
    mutationFn: (data) => base44.entities.PriceListItem.create({
      ...data,
      company_id: myCompany?.id
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
    },
  });

  const createCodeMutation = useMutation({
    mutationFn: (data) => base44.entities.BuildingCode.create({
      ...data,
      company_id: myCompany?.id
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['building-codes'] });
      setShowCodeDialog(false);
      setCodeFormData({ code: "", description: "", category: "Other" });
      setEditingCode(null);
    },
  });

  const updateCodeMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.BuildingCode.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['building-codes'] });
      setShowCodeDialog(false);
      setCodeFormData({ code: "", description: "", category: "Other" });
      setEditingCode(null);
    },
  });

  const deleteCodeMutation = useMutation({
    mutationFn: (id) => base44.entities.BuildingCode.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['building-codes'] });
    },
  });

  const downloadCodesTemplate = () => {
    const rows = [
      ['code', 'description', 'category'],
      ['IWS', 'Ice & Water Shield required in first 24" from eave', 'Roofing'],
      ['RFG 240', 'Minimum 240 lb shingle requirement', 'Roofing'],
      ['GTR ALUM', 'Aluminum gutter requirement', 'Gutters'],
    ];
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'building_codes_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCodesCsvImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !myCompany?.id) return;
    e.target.value = '';
    setIsImportingCodes(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) throw new Error('CSV appears empty');

      const sep = lines[0].includes('\t') ? '\t' : ',';
      const parseRow = (line) => line.split(sep).map(v => v.replace(/^"|"$/g, '').trim());
      const headers = parseRow(lines[0]).map(h => h.toLowerCase());

      const codeIdx = headers.findIndex(h => h.includes('code'));
      const descIdx = headers.findIndex(h => h.includes('desc'));
      const catIdx  = headers.findIndex(h => h.includes('cat'));

      if (codeIdx === -1) throw new Error('CSV must have a "code" column');

      const validCategories = ['Roofing', 'Gutters', 'Siding', 'Windows', 'General', 'Other'];
      let created = 0;
      let skipped = 0;

      for (let i = 1; i < lines.length; i++) {
        const cols = parseRow(lines[i]);
        const code = cols[codeIdx];
        if (!code) { skipped++; continue; }

        const description = descIdx >= 0 ? cols[descIdx] || '' : '';
        const rawCat = catIdx >= 0 ? cols[catIdx] || '' : '';
        const category = validCategories.find(c => c.toLowerCase() === rawCat.toLowerCase()) || 'Other';

        const existing = buildingCodes.find(bc => bc.code.toLowerCase() === code.toLowerCase());
        if (existing) { skipped++; continue; }

        await base44.entities.BuildingCode.create({ code, description, category, company_id: myCompany.id });
        created++;
      }

      queryClient.invalidateQueries({ queryKey: ['building-codes'] });
      alert(`Import complete: ${created} codes added, ${skipped} skipped (duplicates or blank rows).`);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setIsImportingCodes(false);
    }
  };

  // Map each tab to its price list source name
  const TAB_SOURCE_MAP = {
    xactimate_new: 'Xactimate_New',
    xactimate: 'Xactimate',
    symbility: 'Symbility',
    custom: 'Custom',
  };
  const activeSource = TAB_SOURCE_MAP[activeTab] || null;
  const isXactimateSource = (source) =>
    source === "Xactimate" || source === "Xactimate_New";

  // Find a non-expired backup for the current tab's source
  const activeBackup = React.useMemo(() => {
    if (!activeSource || !priceListBackups.length) return null;
    const now = new Date();
    return priceListBackups.find(
      b => b.source === activeSource && (!b.expires_at || new Date(b.expires_at) > now)
    ) || null;
  }, [priceListBackups, activeSource]);

  const handleRestoreBackup = async (source, itemCount) => {
    if (!myCompany?.id) return;
    if (!window.confirm(
      `Restore ${itemCount} previous ${source} items?\n\nThis will replace your current ${source} price list items with the backup from before the last import.`
    )) return;
    setIsRestoring(true);
    try {
      const { data } = await base44.functions.invoke('restorePriceListBackup', {
        company_id: myCompany.id,
        source,
      });
      if (data?.success) {
        toast({ title: `✅ Restored ${data.restored} items`, description: `Previous ${source} price list has been restored.` });
        queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
        queryClient.invalidateQueries({ queryKey: ['price-list-backups'] });
      } else {
        toast({ title: '❌ Restore failed', description: data?.error || 'Unknown error', variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: '❌ Restore failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsRestoring(false);
    }
  };

  let tabFilteredItems = allItems;
  if (activeTab === "custom") {
    tabFilteredItems = allItems.filter(item => item.source === "Custom" || !item.source);
  } else if (activeTab === "xactimate_new") { // Added new tab filtering logic
    // Both the legacy importer and the newer Excel importer belong in the
    // single Xactimate tab. Keeping only Xactimate_New hides the older list.
    tabFilteredItems = allItems.filter(item => isXactimateSource(item.source));
  } else if (activeTab === "symbility") {
    tabFilteredItems = allItems.filter(item => item.source === "Symbility");
  }

  const filteredItems = tabFilteredItems.filter(item => {
    // Use the same separator-insensitive matcher as the estimator's item
    // browser. "j ch" must find J-Channel, J_CHANNEL, and J channel alike.
    const matchesSearch = matchesPriceListSearch(item, searchTerm);

    // Match if NO categories selected OR item category is in selected categories
    const matchesCategory = selectedCategories.length === 0 || selectedCategories.includes(item.category);
    const matchesFavorites = !favoritesOnly || item.is_favorite;

    return matchesSearch && matchesCategory && matchesFavorites;
  });

  const itemsPerPageNum = itemsPerPage === "all" ? filteredItems.length : parseInt(itemsPerPage);
  const totalPages = itemsPerPage === "all" ? 1 : Math.ceil(filteredItems.length / itemsPerPageNum);
  const startIndex = (currentPage - 1) * itemsPerPageNum;
  const endIndex = startIndex + itemsPerPageNum;
  const displayedItems = filteredItems.slice(startIndex, endIndex);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategories, favoritesOnly, activeTab, itemsPerPage]); // Changed selectedCategory to selectedCategories

  const customCount = allItems.filter(item => item.source === "Custom" || !item.source).length;
  const xactimateCount = allItems.filter(item => isXactimateSource(item.source)).length;
  const symbilityCount = allItems.filter(item => item.source === "Symbility").length;

  const categories = ["Roofing", "Siding", "Windows", "Doors", "Interior", "Exterior", "HVAC", "Plumbing", "Electrical", "Other"];

  // Calculate category counts from currently filtered tab items
  const categoryCounts = categories.reduce((acc, cat) => {
    acc[cat] = tabFilteredItems.filter(item => item.category === cat).length;
    return acc;
  }, {});

  const getCategoryColor = (category) => {
    const colors = {
      'Roofing': 'bg-blue-100 text-blue-700',
      'Siding': 'bg-green-100 text-green-700',
      'Windows': 'bg-purple-100 text-purple-700',
      'Doors': 'bg-orange-100 text-orange-700',
      'Interior': 'bg-pink-100 text-pink-700',
      'Exterior': 'bg-teal-100 text-teal-700',
      'HVAC': 'bg-red-100 text-red-700',
      'Plumbing': 'bg-indigo-100 text-indigo-700',
      'Electrical': 'bg-yellow-100 text-yellow-700',
      'Other': 'bg-gray-100 text-gray-700'
    };
    return colors[category] || colors.Other;
  };

  const handleSelectAll = () => {
    if (selectedItems.length === displayedItems.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(displayedItems.map(item => item.id));
    }
  };

  const handleSelectItem = (id) => {
    if (selectedItems.includes(id)) {
      setSelectedItems(selectedItems.filter(itemId => itemId !== id));
    } else {
      setSelectedItems([...selectedItems, id]);
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedItems.length} selected items?`)) return;

    try {
      await base44.entities.PriceListItem.bulkDelete(selectedItems);
      queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
      setSelectedItems([]);
    } catch (err) {
      alert('Some items could not be deleted: ' + (err.message || 'Unknown error'));
      queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
      setSelectedItems([]);
    }
  };

  const handleAddToEstimate = () => {
    const itemsToAdd = allItems.filter(item => selectedItems.includes(item.id));

    localStorage.setItem('pendingEstimateItems', JSON.stringify(itemsToAdd.map(item => ({
      code: item.code || item.sku,
      description: item.description || item.name,
      long_description: item.long_description || "",
      quantity: 1,
      unit: item.unit || "EA",
      rate: item.price,
      category: item.category,
      source: item.source,
      amount: item.price
    }))));

    window.location.href = createPageUrl('Estimates') + '?add_items=true';
  };

  const handleExport = () => {
    const headers = ["Code", "Description", "Unit", "Price", "Category", "Source"];
    const csvRows = [headers.join(',')];

    for (const item of filteredItems) {
      const row = [
        `"${item.code || item.sku || ''}"`,
        `"${(item.description || item.name || '').replace(/"/g, '""')}"`,
        `"${item.unit}"`,
        item.price,
        `"${item.category}"`,
        `"${item.source || ''}"`
      ];
      csvRows.push(row.join(','));
    }

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'items_export.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCreateItem = () => {
    window.location.href = createPageUrl('CreateItem'); // Assuming 'CreateItem' is a valid page route
  };

  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible + 2) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= maxVisible; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - maxVisible + 1; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(1);
        pages.push('...');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(totalPages);
      }
    }

    return pages;
  };

  const toggleCategory = (category) => {
    setSelectedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const clearCategories = () => {
    setSelectedCategories([]);
  };

  const handleEditCode = (code) => {
    setEditingCode(code);
    setCodeFormData({
      code: code.code,
      description: code.description,
      category: code.category
    });
    setShowCodeDialog(true);
  };

  const handleSubmitCode = () => {
    if (editingCode) {
      updateCodeMutation.mutate({ id: editingCode.id, data: codeFormData });
    } else {
      createCodeMutation.mutate(codeFormData);
    }
  };

  const handleExcelUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // If existing Xactimate New items exist, confirm before replacing
    const existingXactNew = allItems.filter(i => i.source === 'Xactimate_New');
    if (existingXactNew.length > 0) {
      if (!window.confirm(
        `⚠️ Override existing price list?\n\nYou have ${existingXactNew.length} existing Xactimate items.\nThis import will replace them all with items from the new file.\n\nOverride & Import?`
      )) {
        event.target.value = '';
        return;
      }
    }

    setIsImportingExcel(true);
    try {
      // Upload file first
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      // Call the import function
      const { data } = await base44.functions.invoke('importXactimateExcel', {
        file_url,
        company_id: myCompany?.id
      });
      
      if (data.success) {
        alert(`✅ Import Complete!\n\nSheets processed: ${data.total_sheets}\nItems imported: ${data.items_imported}\nErrors: ${data.errors}`);
        queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
        setActiveTab('xactimate_new');
      } else {
        alert(`❌ Import failed: ${data.error}`);
      }
    } catch (error) {
      alert(`❌ Import failed: ${error.message}`);
    } finally {
      setIsImportingExcel(false);
      event.target.value = '';
    }
  };

  return (
    <div className="p-3 sm:p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
          <Plug className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Items</h1>
          <p className="text-gray-500 mt-1">Connect and manage your external integrations for pricing.</p>
        </div>
      </div>

      <Card className="bg-white shadow-md">
        <CardContent className="p-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="w-full justify-start border-b rounded-none bg-transparent p-0 h-auto overflow-x-auto flex-nowrap" style={{ scrollbarWidth: 'none' }}>
              <TabsTrigger
                value="all"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent flex-shrink-0 whitespace-nowrap"
              >
                All ({allItems.length})
              </TabsTrigger>
              <TabsTrigger
                value="custom"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent flex-shrink-0 whitespace-nowrap"
              >
                Custom ({customCount})
              </TabsTrigger>
              <TabsTrigger
                value="xactimate_new"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-orange-600 data-[state=active]:bg-transparent flex-shrink-0 whitespace-nowrap"
              >
                Xactimate ({xactimateCount})
              </TabsTrigger>
              <TabsTrigger
                value="symbility"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent flex-shrink-0 whitespace-nowrap"
              >
                Symbility ({symbilityCount})
              </TabsTrigger>
              <TabsTrigger
                value="codes"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-green-600 data-[state=active]:bg-transparent flex-shrink-0 whitespace-nowrap"
              >
                <Code2 className="w-4 h-4 mr-2" />
                Building Codes ({buildingCodes.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="codes" className="p-4 space-y-4">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                  <h3 className="text-lg font-semibold">Building Codes Reference</h3>
                  <p className="text-sm text-gray-500">Manage your standard building codes (IWS, DE, RFG, etc.)</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={downloadCodesTemplate} data-testid="button-download-codes-template">
                    <Download className="w-4 h-4 mr-2" />
                    CSV Template
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => codesCsvInputRef.current?.click()}
                    disabled={isImportingCodes}
                    data-testid="button-import-codes-csv"
                  >
                    {isImportingCodes ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                    {isImportingCodes ? 'Importing…' : 'Import CSV'}
                  </Button>
                  <input
                    ref={codesCsvInputRef}
                    type="file"
                    accept=".csv,.tsv,.txt"
                    className="hidden"
                    onChange={handleCodesCsvImport}
                    data-testid="input-codes-csv"
                  />
                  <Button
                    onClick={() => {
                      setEditingCode(null);
                      setCodeFormData({ code: "", description: "", category: "Other" });
                      setShowCodeDialog(true);
                    }}
                    className="bg-green-600 hover:bg-green-700"
                    data-testid="button-add-code"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Code
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {buildingCodes.map((code) => (
                  <Card key={code.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <code className="text-lg font-mono font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">
                              {code.code}
                            </code>
                            <Badge className={getCategoryColor(code.category)}>
                              {code.category}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-700">{code.description}</p>
                        </div>
                        <div className="flex gap-1 ml-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleEditCode(code)}
                          >
                            <Edit className="w-4 h-4 text-gray-600" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              if (window.confirm('Delete this code?')) {
                                deleteCodeMutation.mutate(code.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {buildingCodes.length === 0 && (
                  <div className="col-span-full py-12 text-center text-gray-500">
                    <Code2 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="text-lg font-medium mb-2">No building codes yet</p>
                    <p className="text-sm">Add standard codes like IWS, DE, RFG for quick reference</p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* 24h recovery banner — shown when an override backup exists for the active tab */}
            {activeBackup && activeTab !== 'codes' && (
              <div className="mx-4 mt-3 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
                <RotateCcw className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span className="flex-1 text-amber-800">
                  <strong>{activeBackup.item_count || activeBackup.items?.length || '?'} previous {activeBackup.source === 'Xactimate_New' ? 'Xactimate' : activeBackup.source} items</strong> are available for recovery
                  {activeBackup.expires_at && (
                    <span className="text-amber-600 ml-1 text-xs">(expires {new Date(activeBackup.expires_at).toLocaleString()})</span>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-400 text-amber-700 hover:bg-amber-100 flex-shrink-0"
                  disabled={isRestoring}
                  onClick={() => handleRestoreBackup(
                    activeBackup.source,
                    activeBackup.item_count || activeBackup.items?.length || 0
                  )}
                >
                  {isRestoring
                    ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    : <RotateCcw className="w-3 h-3 mr-1" />}
                  Restore previous items
                </Button>
              </div>
            )}

            <div className="p-4 space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <Select value={itemsPerPage} onValueChange={(v) => { setItemsPerPage(v); setCurrentPage(1); }}>
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="250">250</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                    <SelectItem value="1000">1000</SelectItem>
                    <SelectItem value="1500">1500</SelectItem>
                    <SelectItem value="2000">2000</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                  </SelectContent>
                </Select>

                {/* Multi-Category Selector with Checkboxes */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="min-w-[180px] justify-between">
                      <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4" />
                        {selectedCategories.length === 0
                          ? "All Categories"
                          : `${selectedCategories.length} Selected`
                        }
                      </div>
                      {selectedCategories.length > 0 && (
                        <X
                          className="w-4 h-4 ml-2 hover:bg-gray-200 rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearCategories();
                          }}
                        />
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-semibold">Filter by Category</p>
                        {selectedCategories.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearCategories}
                            className="h-6 text-xs"
                          >
                            Clear All
                          </Button>
                        )}
                      </div>
                      {categories.map(cat => (
                        <div key={cat} className="flex items-center gap-2">
                          <Checkbox
                            id={`category-${cat}`}
                            checked={selectedCategories.includes(cat)}
                            onCheckedChange={() => toggleCategory(cat)}
                          />
                          <label
                            htmlFor={`category-${cat}`}
                            className="text-sm cursor-pointer flex-1 flex items-center justify-between"
                          >
                            <span>{cat}</span>
                            <span className="text-xs text-gray-500 ml-2">{categoryCounts[cat]}</span>
                          </label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Show selected category badges */}
                {selectedCategories.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {selectedCategories.map(cat => (
                      <Badge
                        key={cat}
                        className={`${getCategoryColor(cat)} cursor-pointer hover:opacity-80`}
                        onClick={() => toggleCategory(cat)}
                      >
                        {cat}
                        <X className="w-3 h-3 ml-1" />
                      </Badge>
                    ))}
                  </div>
                )}

                <Button
                  variant={favoritesOnly ? "default" : "outline"}
                  onClick={() => setFavoritesOnly(!favoritesOnly)}
                  className="flex items-center gap-2"
                >
                  <Star className="w-4 h-4" />
                  Favorites Only
                </Button>

                <div className="flex gap-3">
                  <Button
                    onClick={handleCreateItem}
                    className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  >
                    <Plus className="w-5 h-5 mr-2" />
                    Create New Item
                  </Button>

                  {allItems.length === 0 && (
                    <Button
                      onClick={async () => {
                        setIsAddingSamples(true);
                        try {
                          const res = await base44.functions.invoke('addSamplePrices', { company_id: myCompany?.id });
                          const msg = res?.data?.message || res?.message || 'Sample items added';
                          toast({ title: '✅ ' + msg, description: 'Refresh the page if items don\'t appear immediately.' });
                          queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
                        } catch (error) {
                          toast({ title: 'Failed to add sample items', description: error.message, variant: 'destructive' });
                        } finally {
                          setIsAddingSamples(false);
                        }
                      }}
                      disabled={isAddingSamples}
                      variant="outline"
                      className="border-green-300 text-green-700 hover:bg-green-50"
                    >
                      {isAddingSamples ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                      {isAddingSamples ? 'Adding…' : 'Add Sample Items'}
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    onClick={handleExport}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </Button>

                  <Link to={createPageUrl('DataImport') + '?entity=Item'}>
                    <Button variant="outline">
                      <Upload className="w-4 h-4 mr-2" />
                      Import CSV
                    </Button>
                  </Link>

                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".xlsx,.xls"
                    onChange={handleExcelUpload}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isImportingExcel}
                    className="border-orange-300 text-orange-700 hover:bg-orange-50"
                  >
                    {isImportingExcel ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-4 h-4 mr-2" />
                    )}
                    {isImportingExcel ? 'Importing...' : 'Upload Xactimate Excel'}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={async () => {
                      if (window.confirm('🏷️ This will automatically categorize all items currently in "Other" category based on their descriptions.\n\nContinue?')) {
                        try {
                          const { data } = await base44.functions.invoke('categorizePriceListItems', { company_id: myCompany?.id });
                          alert(`✅ Success!\n\nUpdated: ${data.updated} items\nRemaining as Other: ${data.skipped} items`);
                          queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
                        } catch (error) {
                          alert('❌ Failed: ' + error.message);
                        }
                      }
                    }}
                    className="border-purple-300 text-purple-700 hover:bg-purple-50"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    Auto-Categorize
                  </Button>

                  <BulkDeleteButton
                    variant="destructive"
                    onClick={async () => {
                      if (window.confirm('⚠️ This will DELETE ALL price list items (' + allItems.length + ' total).\n\nThis action cannot be undone. Continue?')) {
                        try {
                          const data = await base44.entities.PriceListItem.bulkDelete(allItems.map(item => item.id));
                          alert(`✅ Deleted ${data.deleted_count} items. Ready for fresh import!`);
                          queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
                        } catch (error) {
                          alert('❌ Failed: ' + error.message);
                        }
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete All
                  </BulkDeleteButton>
                  </div>

                {selectedItems.length > 0 && (
                  <>
                    <Button
                      onClick={handleAddToEstimate}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <Check className="w-4 h-4 mr-2" />
                      Add {selectedItems.length} to Estimate
                    </Button>
                    <BulkDeleteButton variant="outline" onClick={handleBulkDelete}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete ({selectedItems.length})
                    </BulkDeleteButton>
                  </>
                )}

                <div className="relative flex-1 min-w-[300px] ml-auto">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search items..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              {isMobile ? (
                <div className="divide-y divide-gray-100">
                  {displayedItems.map((item) => (
                    <div
                      key={item.id}
                      data-testid={`item-card-${item.id}`}
                      className={`flex items-start gap-3 py-3 px-1 ${item.is_active === false ? 'opacity-40' : ''}`}
                    >
                      <button
                        className="mt-0.5 flex-shrink-0"
                        onClick={() => toggleFavoriteMutation.mutate({ id: item.id, isFavorite: item.is_favorite })}
                      >
                        {item.is_favorite
                          ? <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                          : <StarOff className="w-5 h-5 text-gray-300" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 leading-snug">
                          {item.description || item.name}
                        </p>
                        <code className="text-[11px] text-blue-600 font-mono">
                          {item.code || item.sku}
                        </code>
                        {item.category && (
                          <Badge className={`${getCategoryColor(item.category)} text-[10px] ml-2`}>
                            {item.category}
                          </Badge>
                        )}
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <p className="text-base font-bold text-green-600">${item.price?.toFixed(2)}</p>
                        <p className="text-[11px] text-gray-400">{item.unit || 'EA'}</p>
                      </div>
                    </div>
                  ))}
                  {displayedItems.length === 0 && (
                    <div className="py-12 text-center text-gray-500">
                      <p className="text-lg font-medium mb-2">No items found</p>
                      <p className="text-sm">Try adjusting your search or filter</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b text-left text-sm text-gray-600">
                        <th className="pb-3 pr-4 w-12">
                          <Checkbox
                            checked={selectedItems.length === displayedItems.length && displayedItems.length > 0}
                            onCheckedChange={handleSelectAll}
                          />
                        </th>
                        <th className="pb-3 font-medium w-12">Active</th>
                        <th className="pb-3 font-medium w-12">Fav</th>
                        <th className="pb-3 font-medium w-32">Code</th>
                        <th className="pb-3 font-medium" style={{ minWidth: '300px' }}>Description</th>
                        <th className="pb-3 font-medium" style={{ minWidth: '300px' }}>Long Description</th>
                        <th className="pb-3 font-medium w-28">Source</th>
                        <th className="pb-3 font-medium w-24">Price</th>
                        <th className="pb-3 font-medium w-16">Unit</th>
                        <th className="pb-3 font-medium w-24">Category</th>
                        <th className="pb-3 font-medium w-20">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedItems.map((item) => (
                        <tr key={item.id} className={`border-b hover:bg-gray-50 ${item.is_active === false ? 'opacity-40 bg-gray-100' : ''}`}>
                          <td className="px-4 py-3 pr-4">
                            <Checkbox
                              checked={selectedItems.includes(item.id)}
                              onCheckedChange={() => handleSelectItem(item.id)}
                            />
                          </td>
                          <td className="py-3">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => toggleActiveMutation.mutate({
                                id: item.id,
                                isActive: item.is_active !== false
                              })}
                              title={item.is_active === false ? "Inactive - Click to activate" : "Active - Click to deactivate"}
                            >
                              {item.is_active === false ? (
                                <X className="w-4 h-4 text-red-500" />
                              ) : (
                                <Check className="w-4 h-4 text-green-500" />
                              )}
                            </Button>
                          </td>
                          <td className="py-3">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => toggleFavoriteMutation.mutate({
                                id: item.id,
                                isFavorite: item.is_favorite
                              })}
                            >
                              {item.is_favorite ? (
                                <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                              ) : (
                                <StarOff className="w-4 h-4 text-gray-400" />
                              )}
                            </Button>
                          </td>
                          <td className="py-3" title={`${item.code || item.sku}\n${item.description || item.name}`}>
                            <code className="text-xs font-mono font-semibold text-blue-600 block whitespace-nowrap">
                              {(() => { const c = item.code || item.sku || ''; return c.length > 12 ? c.substring(0, 12) + '...' : c; })()}
                            </code>
                          </td>
                          <td className="py-3 pr-4" style={{ minWidth: '300px' }} title={item.description || item.name}>
                            <div className="text-sm text-gray-900 whitespace-normal break-words">
                              {item.description || item.name}
                            </div>
                          </td>
                          <td className="py-3 pr-4" style={{ minWidth: '300px' }} title={item.long_description || ''}>
                            <div className="text-sm text-gray-600 whitespace-normal break-words italic">
                              {item.long_description || <span className="text-gray-400">—</span>}
                            </div>
                          </td>
                          <td className="py-3">
                            <Badge variant="outline" className="text-xs whitespace-nowrap">
                              {item.source === "Xactimate_New" ? "Xactimate" : item.source || "Custom"}
                            </Badge>
                          </td>
                          <td className="py-3 font-semibold text-green-600 text-right whitespace-nowrap">
                            ${item.price?.toFixed(2)}
                          </td>
                          <td className="py-3 text-sm text-gray-600 text-center">
                            {item.unit || "EA"}
                          </td>
                          <td className="py-3">
                            <Badge className={`${getCategoryColor(item.category)} text-xs whitespace-nowrap`}>
                              {item.category}
                            </Badge>
                          </td>
                          <td className="py-3">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                if (window.confirm('Delete this item?')) {
                                  deleteMutation.mutate(item.id);
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {displayedItems.length === 0 && (
                       <tr>
                         <td colSpan={11} className="py-8 text-center text-gray-500">
                           {/* Xactimate tab guidance */}
                           {activeTab === 'xactimate_new' && (
                             <div className="max-w-xl mx-auto text-left bg-orange-50 border border-orange-200 rounded-xl p-6">
                               <div className="flex items-center gap-3 mb-4">
                                 <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                                   <FileSpreadsheet className="w-5 h-5 text-orange-600" />
                                 </div>
                                 <div>
                                   <h3 className="font-semibold text-gray-800">Import your Xactimate price list</h3>
                                   <p className="text-sm text-gray-500">Bring in your exact Xactimate prices in one click</p>
                                 </div>
                               </div>
                               <ol className="space-y-2 text-sm text-gray-700 mb-5">
                                 <li className="flex gap-2"><span className="font-bold text-orange-600 w-5 flex-shrink-0">1.</span>Open Xactimate on your desktop</li>
                                 <li className="flex gap-2"><span className="font-bold text-orange-600 w-5 flex-shrink-0">2.</span>Go to <strong>Tools → Price List</strong> (or <strong>Settings → Price List</strong>)</li>
                                 <li className="flex gap-2"><span className="font-bold text-orange-600 w-5 flex-shrink-0">3.</span>Select your price list and click <strong>Export → Excel (.xlsx)</strong></li>
                                 <li className="flex gap-2"><span className="font-bold text-orange-600 w-5 flex-shrink-0">4.</span>Upload that file below — we'll import all codes, descriptions, and prices automatically</li>
                               </ol>
                               <button
                                 onClick={() => fileInputRef.current?.click()}
                                 disabled={isImportingExcel}
                                 className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-md text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
                               >
                                 {isImportingExcel ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                                 {isImportingExcel ? 'Importing…' : 'Upload Xactimate Excel'}
                               </button>
                             </div>
                           )}

                           {/* Symbility tab guidance */}
                           {activeTab === 'symbility' && (
                             <div className="max-w-xl mx-auto text-left bg-blue-50 border border-blue-200 rounded-xl p-6">
                               <div className="flex items-center gap-3 mb-4">
                                 <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                                   <Upload className="w-5 h-5 text-blue-600" />
                                 </div>
                                 <div>
                                   <h3 className="font-semibold text-gray-800">Import your Symbility price list</h3>
                                   <p className="text-sm text-gray-500">Export from CoreLogic Symbility and import as CSV</p>
                                 </div>
                               </div>
                               <ol className="space-y-2 text-sm text-gray-700 mb-5">
                                 <li className="flex gap-2"><span className="font-bold text-blue-600 w-5 flex-shrink-0">1.</span>Open Symbility (CoreLogic) on your desktop</li>
                                 <li className="flex gap-2"><span className="font-bold text-blue-600 w-5 flex-shrink-0">2.</span>Go to <strong>Tools → Price List</strong> or <strong>Administration → Price Lists</strong></li>
                                 <li className="flex gap-2"><span className="font-bold text-blue-600 w-5 flex-shrink-0">3.</span>Select your price list and choose <strong>Export → CSV</strong></li>
                                 <li className="flex gap-2"><span className="font-bold text-blue-600 w-5 flex-shrink-0">4.</span>Import that CSV here — make sure columns include <strong>Code, Description, Price, Unit</strong></li>
                               </ol>
                               <div className="flex gap-2 flex-wrap">
                                 <input
                                   type="file"
                                   accept=".csv,.xlsx,.xls"
                                   className="hidden"
                                   id="symbility-import-input"
                                   onChange={async (e) => {
                                     const file = e.target.files?.[0];
                                     if (!file || !myCompany?.id) return;
                                     setIsImportingExcel(true);
                                     try {
                                       const { file_url } = await base44.integrations.Core.UploadFile({ file });
                                       const { data } = await base44.functions.invoke('importXactimateExcel', {
                                         file_url, company_id: myCompany.id, source_override: 'Symbility'
                                       });
                                       if (data?.items_imported) {
                                         toast({ title: `✅ Imported ${data.items_imported} Symbility items` });
                                         queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
                                       } else {
                                         toast({ title: '❌ Import failed', description: data?.error || 'Unknown error', variant: 'destructive' });
                                       }
                                     } catch (err) {
                                       toast({ title: '❌ Import failed', description: err.message, variant: 'destructive' });
                                     } finally {
                                       setIsImportingExcel(false);
                                       e.target.value = '';
                                     }
                                   }}
                                 />
                                 <button
                                   onClick={() => document.getElementById('symbility-import-input')?.click()}
                                   disabled={isImportingExcel}
                                   className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                                 >
                                   {isImportingExcel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                                   {isImportingExcel ? 'Importing…' : 'Upload Symbility CSV'}
                                 </button>
                               </div>
                             </div>
                           )}

                           {/* Generic / All tab empty state */}
                           {(activeTab === 'all' || activeTab === 'custom') && (
                             <div>
                               <p className="text-lg font-medium mb-2">No items found</p>
                               {allItems.length === 0 ? (
                                 <div className="mt-3">
                                   <p className="text-sm mb-3">Get started with a standard set of roofing line items</p>
                                   <button
                                     onClick={async () => {
                                       setIsAddingSamples(true);
                                       try {
                                         const res = await base44.functions.invoke('addSamplePrices', { company_id: myCompany?.id });
                                         const msg = res?.data?.message || res?.message || 'Sample items added';
                                         toast({ title: '✅ ' + msg, description: 'Your price list is ready.' });
                                         queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
                                       } catch (error) {
                                         toast({ title: 'Failed to add sample items', description: error.message, variant: 'destructive' });
                                       } finally {
                                         setIsAddingSamples(false);
                                       }
                                     }}
                                     disabled={isAddingSamples}
                                     className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                                   >
                                     {isAddingSamples ? 'Adding…' : '+ Add Sample Items'}
                                   </button>
                                 </div>
                               ) : (
                                 <p className="text-sm">Try adjusting your search or filter</p>
                               )}
                             </div>
                           )}
                         </td>
                       </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {filteredItems.length > 0 && (
                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="text-sm text-gray-500">
                    Showing {startIndex + 1}-{Math.min(endIndex, filteredItems.length)} of {filteredItems.length} items
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Previous
                    </Button>

                    {getPageNumbers().map((page, index) => (
                      page === '...' ? (
                        <span key={`ellipsis-${index}`} className="px-2 text-gray-400">...</span>
                      ) : (
                        <Button
                          key={page}
                          variant={currentPage === page ? "default" : "outline"}
                          size="sm"
                          onClick={() => setCurrentPage(page)}
                          className="min-w-[40px]"
                        >
                          {page}
                        </Button>
                      )
                    ))}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Next
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Tabs>
        </CardContent>
      </Card>

      {/* Code Dialog */}
      {showCodeDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardContent className="p-3 sm:p-6 space-y-4">
              <h3 className="text-lg font-semibold">
                {editingCode ? 'Edit Building Code' : 'Add Building Code'}
              </h3>
              
              <div>
                <label className="text-sm font-medium mb-1 block">Code *</label>
                <Input
                  value={codeFormData.code}
                  onChange={(e) => setCodeFormData({...codeFormData, code: e.target.value.toUpperCase()})}
                  placeholder="e.g., IWS, DE, RFG"
                  className="font-mono"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Description *</label>
                <Input
                  value={codeFormData.description}
                  onChange={(e) => setCodeFormData({...codeFormData, description: e.target.value})}
                  placeholder="e.g., Ice and Water Shield"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Category</label>
                <Select 
                  value={codeFormData.category} 
                  onValueChange={(value) => setCodeFormData({...codeFormData, category: value})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCodeDialog(false);
                    setEditingCode(null);
                    setCodeFormData({ code: "", description: "", category: "Other" });
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmitCode}
                  disabled={!codeFormData.code || !codeFormData.description}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {editingCode ? 'Update' : 'Add'} Code
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}