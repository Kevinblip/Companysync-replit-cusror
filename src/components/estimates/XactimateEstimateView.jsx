
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import ItemDropdown from "./ItemDropdown";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label"; // NEW: Import Label

// Helper function for date formatting (using native Date.toLocaleDateString)
const safeFormatDate = (dateString, formatStr) => { // formatStr parameter is for consistency but unused in this simple impl
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return ''; // Invalid date
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString(undefined, options);
  } catch (error) {
    console.error("Error formatting date:", error);
    return '';
  }
};

export default function XactimateEstimateView({ estimate, formats = [] }) {
  const [items, setItems] = useState(estimate.items || []);
  const [isEditing, setIsEditing] = useState(false);
  const [customTaxRate, setCustomTaxRate] = useState(null); // NEW: State for custom tax rate (percentage, e.g., 8.25)
  const queryClient = useQueryClient();

  // Get company info
  const { data: myCompany } = useQuery({
    queryKey: ['company-info'],
    queryFn: () => base44.entities.Company.list().then(res => res[0]), // Assuming one company or taking the first one
    staleTime: Infinity, // Company info likely doesn't change often
  });

  // Get the format template if one is selected
  const format = formats.find(f => f.id === estimate.format_id);

  // Use format settings or defaults
  // FIX: Default tax to 0% for custom, allow override
  const baseTaxRate = format?.tax_rate !== undefined ? format.tax_rate / 100 : 0; // Changed default from 0.10 to 0
  const taxRate = customTaxRate !== null ? customTaxRate / 100 : baseTaxRate; // Use custom if set, otherwise base
  const allowTaxOverride = format?.allow_tax_override !== false; // NEW: Allow tax override setting (default true if not specified)

  const showRcvAcv = format?.show_rcv_acv !== false;
  const showDepreciation = format?.show_depreciation || false;
  const showTaxBreakdown = format?.show_tax_breakdown !== false;
  const colorScheme = format?.color_scheme || 'blue';

  const colorSchemes = {
    blue: 'bg-blue-600',
    green: 'bg-green-600',
    gray: 'bg-gray-600',
    red: 'bg-red-600'
  };

  // Initialize customTaxRate once when component mounts or format changes
  React.useEffect(() => {
    if (format?.tax_rate !== undefined && customTaxRate === null) {
      setCustomTaxRate(format.tax_rate);
    } else if (format?.tax_rate === undefined && customTaxRate === null) {
      setCustomTaxRate(0); // If format has no tax rate, default to 0 for custom input
    }
  }, [format, customTaxRate]);


  const { data: xactimatePriceList = [] } = useQuery({
    queryKey: ['xactimate-prices'],
    queryFn: () => base44.entities.PriceListItem.filter({ source: "Xactimate" }, "-created_date", 10000),
    initialData: [],
  });

  const { data: customPriceList = [] } = useQuery({
    queryKey: ['custom-prices'],
    queryFn: () => base44.entities.PriceListItem.filter({ source: "Custom" }, "-created_date", 10000),
    initialData: [],
  });

  const { data: symbilityPriceList = [] } = useQuery({
    queryKey: ['symbility-prices'],
    queryFn: () => base44.entities.PriceListItem.filter({ source: "Symbility" }, "-created_date", 10000),
    initialData: [],
  });

  // Recalculate totals using current items state
  const subtotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const tax = subtotal * taxRate;
  const rcv = subtotal + tax;

  const updateEstimateMutation = useMutation({
    mutationFn: (data) => base44.entities.Estimate.update(estimate.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimates'] });
      queryClient.invalidateQueries({ queryKey: ['estimate', estimate.id] });
      setIsEditing(false);
    },
    onError: (error) => {
      console.error("Failed to update estimate:", error);
    }
  });

  const lookupPriceByCode = (code, source = "xactimate") => {
    if (!code) return { found: false };

    let priceList = [];
    if (source === "xactimate") {
      priceList = xactimatePriceList;
    } else if (source === "custom") {
      priceList = customPriceList;
    } else if (source === "symbility") {
      priceList = symbilityPriceList;
    } else {
      return { found: false };
    }

    const cleanCode = (c) => c?.toUpperCase().trim().replace(/\s+/g, ' ');
    const searchCode = cleanCode(code);

    const exactMatch = priceList.find(item => cleanCode(item.code) === searchCode);

    if (exactMatch) {
      return {
        found: true,
        code: exactMatch.code,
        description: exactMatch.description,
        unit: exactMatch.unit,
        rate: exactMatch.price,
        category: exactMatch.category,
        source: exactMatch.source
      };
    }

    return { found: false };
  };

  const handleFormatChange = async (newFormatId) => {
    const newFormat = formats.find(f => f.id === newFormatId);
    const oldFormat = formats.find(f => f.id === estimate.format_id);

    const getFormatSource = (format) => {
      if (!format || format.id === "none") return "custom";

      const companyName = format.insurance_company?.toLowerCase() || '';

      if (companyName.includes("xactimate")) {
        return "xactimate";
      } else if (companyName.includes("symbility")) {
        return "symbility";
      }
      return "custom";
    };

    const oldSource = getFormatSource(oldFormat);
    const newSource = getFormatSource(newFormat);

    console.log('Format change:', { oldSource, newSource, itemsCount: items.length });

    // Reset custom tax rate to the new format's default right away
    setCustomTaxRate(newFormat?.tax_rate !== undefined ? newFormat.tax_rate : null);


    if (oldSource !== newSource && items.length > 0) {
      const confirmConvert = window.confirm(
        `You're switching from ${oldSource.toUpperCase()} to ${newSource.toUpperCase()} pricing.\n\nDo you want to update all item prices to ${newSource.toUpperCase()} rates?\n\n(Items not found in ${newSource} will keep their current prices)`
      );

      if (confirmConvert) {
        const updatedItems = items.map(item => {
          const lookup = lookupPriceByCode(item.code, newSource);

          console.log('Lookup for', item.code, ':', lookup);

          if (lookup.found) {
            const newQuantity = parseFloat(item.quantity) || 1;
            const newRate = parseFloat(lookup.rate) || 0;
            const newAmount = newQuantity * newRate;
            return {
              ...item,
              rate: newRate,
              amount: newAmount,
              source: lookup.source
            };
          }

          return item;
        });

        const newSubtotal = updatedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        const newFormatTaxRate = (newFormat?.tax_rate !== undefined ? newFormat.tax_rate / 100 : 0);
        const newTax = newSubtotal * newFormatTaxRate;
        const newRcv = newSubtotal + newTax;

        setItems(updatedItems);
        setIsEditing(true);

        await updateEstimateMutation.mutateAsync({
          format_id: newFormatId === "none" ? null : newFormatId,
          items: updatedItems,
          amount: newSubtotal,
          subtotal: newSubtotal,
          tax: newTax,
          rcv: newRcv,
        });

        const convertedCount = updatedItems.filter((item, i) => item.rate !== items[i].rate).length;
        alert(`✅ Converted ${convertedCount} of ${items.length} items to ${newSource.toUpperCase()} pricing!`);
        return;
      }
    }

    await updateEstimateMutation.mutateAsync({
      format_id: newFormatId === "none" ? null : newFormatId
    });
    queryClient.invalidateQueries({ queryKey: ['estimate', estimate.id] });
  };

  const handleAddItem = (selectedItem = null) => {
    const newItem = selectedItem ? {
      code: selectedItem.code || "",
      description: selectedItem.description || "",
      quantity: 1,
      unit: selectedItem.unit || "EA",
      rate: selectedItem.rate || 0,
      amount: selectedItem.rate || 0
    } : {
      code: "",
      description: "",
      quantity: 1,
      unit: "EA",
      rate: 0,
      amount: 0
    };
    setItems([...items, newItem]);
    setIsEditing(true);
  };

  const handleUpdateItem = (index, field, value) => {
    const updated = [...items];
    updated[index][field] = value;

    if (field === 'quantity' || field === 'rate') {
      const qty = parseFloat(updated[index].quantity) || 0;
      const rate = parseFloat(updated[index].rate) || 0;
      updated[index].amount = qty * rate;
    }

    setItems(updated);
    setIsEditing(true);
  };

  const handleDeleteItem = (index) => {
    setItems(items.filter((_, i) => i !== index));
    setIsEditing(true);
  };

  const handleSelectItemForRow = (index, selectedItem) => {
    const updated = [...items];
    const currentQuantity = parseFloat(updated[index].quantity) || 1;
    updated[index] = {
      ...updated[index],
      code: selectedItem.code,
      description: selectedItem.description,
      unit: selectedItem.unit,
      rate: selectedItem.rate,
      amount: currentQuantity * (selectedItem.rate || 0)
    };
    setItems(updated);
    setIsEditing(true);
  };

  const handleSaveChanges = () => {
    const totalAmount = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    updateEstimateMutation.mutate({
      items,
      amount: totalAmount,
      subtotal: subtotal,
      tax: tax,
      rcv: rcv,
    });
  };

  const handleCancelChanges = () => {
    setItems(estimate.items || []);
    setIsEditing(false);
    // Reset custom tax rate to the format's default
    setCustomTaxRate(format?.tax_rate !== undefined ? format.tax_rate : null);
  };

  const escapeXml = (str) => {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  };

  const exportToXactimate = () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xactimate version="28.0">
  <estimate>
    <header>
      <estimateNumber>${escapeXml(estimate.estimate_number)}</estimateNumber>
      <customerName>${escapeXml(estimate.customer_name)}</customerName>
      <dateCreated>${estimate.created_date ? new Date(estimate.created_date).toISOString() : ''}</dateCreated>
      <totalRCV>${rcv.toFixed(2)}</totalRCV>
    </header>
    <lineItems>
${items.map((item, index) => `      <lineItem>
        <lineNumber>${index + 1}</lineNumber>
        <code>${escapeXml(item.code)}</code>
        <description>${escapeXml(item.description)}</description>
        <quantity>${item.quantity || 0}</quantity>
        <unit>${escapeXml(item.unit || 'EA')}</unit>
        <unitPrice>${item.rate || 0}</unitPrice>
        <total>${item.amount || 0}</total>
        <category>${escapeXml(item.category || 'General')}</category>
      </lineItem>`).join('\n')}
    </lineItems>
    <summary>
      <subtotal>${subtotal.toFixed(2)}</subtotal>
      <tax>${tax.toFixed(2)}</tax>
      <total>${rcv.toFixed(2)}</total>
    </summary>
  </estimate>
</xactimate>`;

    const blob = new Blob([xml], { type: 'application/xml' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${estimate.estimate_number || 'estimate'}_xactimate.esx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToSymbility = () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<symbilityEstimate>
  <header>
    <estimateId>${escapeXml(estimate.estimate_number)}</estimateId>
    <customerName>${escapeXml(estimate.customer_name)}</customerName>
    <createdDate>${estimate.created_date ? new Date(estimate.created_date).toISOString() : ''}</createdDate>
    <status>${escapeXml(estimate.status || 'Draft')}</status>
  </header>
  <scope>
${items.map((item, index) => `    <item>
      <sequence>${index + 1}</sequence>
      <itemCode>${escapeXml(item.code)}</itemCode>
      <description>${escapeXml(item.description)}</description>
      <quantity>${item.quantity || 0}</quantity>
      <uom>${escapeXml(item.unit || 'EA')}</uom>
      <unitCost>${item.rate || 0}</unitCost>
      <totalCost>${item.amount || 0}</totalCost>
      <trade>${escapeXml(item.category || 'General')}</trade>
    </item>`).join('\n')}
  </scope>
  <totals>
    <rcv>${rcv.toFixed(2)}</rcv>
    <acv>${rcv.toFixed(2)}</acv>
    <depreciation>0.00</depreciation>
  </totals>
</symbilityEstimate>`;

    const blob = new Blob([xml], { type: 'application/xml' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${estimate.estimate_number || 'estimate'}_symbility.xml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToCSV = () => {
    const headers = ["Line", "Code", "Description", "Qty", "Unit", "Unit Price", "RCV", "Depreciation", "ACV"];
    const csvRows = [headers.join(',')];

    items.forEach((item, index) => {
      const row = [
        index + 1,
        `"${(item.code || '').replace(/"/g, '""')}"`,
        `"${(item.description || '').replace(/"/g, '""')}"`,
        item.quantity || 0,
        item.unit || 'EA',
        item.rate || 0,
        item.amount || 0,
        0.00, // Placeholder for depreciation
        item.amount || 0 // Placeholder for ACV
      ];
      csvRows.push(row.join(','));
    });

    csvRows.push('');
    csvRows.push(`Total RCV,,,,,,${rcv.toFixed(2)}`);

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${estimate.estimate_number || 'estimate'}_estimate.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* CLEAN HEADER */}
      <Card>
        <CardHeader className={`${colorSchemes[colorScheme]} text-white`}>
          <div className="grid grid-cols-2 gap-8">
            {/* Left: Company Info */}
            <div>
              <CardTitle className="text-2xl mb-4">
                {format?.insurance_company || myCompany?.company_name || 'Your Company'}
              </CardTitle>
              <div className="text-sm opacity-90 space-y-1">
                {myCompany?.address && <p>{myCompany.address}</p>}
                {myCompany?.city && <p>{myCompany.city}, {myCompany.state} {myCompany.zip}</p>}
                {myCompany?.phone && <p>📞 {myCompany.phone}</p>}
                {myCompany?.email && <p>✉️ {myCompany.email}</p>}
              </div>
            </div>

            {/* Right: Customer & Estimate Info */}
            <div className="text-right">
              <div className="text-3xl font-bold mb-2">
                {estimate.estimate_number}
              </div>
              <div className="text-sm opacity-90 space-y-1">
                <p className="font-semibold text-lg">{estimate.customer_name}</p>
                {estimate.insurance_company && <p>🏥 {estimate.insurance_company}</p>}
                {estimate.claim_number && <p>📋 Claim: {estimate.claim_number}</p>}
                {estimate.project_name && <p>🏗️ {estimate.project_name}</p>}
                <p>📅 {safeFormatDate(estimate.created_date, 'MMMM d, yyyy')}</p>
                {estimate.valid_until && <p>⏰ Valid Until: {safeFormatDate(estimate.valid_until, 'MMMM d, yyyy')}</p>}
              </div>
              <div className="mt-4 bg-white/20 backdrop-blur-sm rounded-lg p-3">
                <div className="text-xs opacity-75 mb-1">Total Amount</div>
                <div className="text-3xl font-bold">${rcv.toFixed(2)}</div>
              </div>
            </div>
          </div>

          {/* Format Selector */}
          <div className="mt-4 pt-4 border-t border-white/20">
            <Label className="text-white text-xs mb-2 block opacity-75">Format Template</Label>
            <Select
              value={estimate.format_id || "none"}
              onValueChange={handleFormatChange}
            >
              <SelectTrigger className="w-64 bg-white/10 text-white border-white/20">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Default Format</SelectItem>
                {formats.filter(f => f.is_active).map((fmt) => (
                  <SelectItem key={fmt.id} value={fmt.id}>
                    {fmt.format_name} {fmt.insurance_company ? `- ${fmt.insurance_company}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        {format?.header_text && (
          <CardContent className="bg-gray-50 border-b p-4">
            <p className="text-sm text-gray-700">{format.header_text}</p>
          </CardContent>
        )}
      </Card>

      {/* Export Buttons - Moved outside the main header card as per outline implying a different structure */}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={exportToXactimate}
          className="text-gray-900"
        >
          Export to Xactimate
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={exportToSymbility}
          className="text-gray-900"
        >
          Export to Symbility
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={exportToCSV}
          className="text-gray-900"
        >
          Export CSV
        </Button>
      </div>


      {/* Line Items Table */}
      <Card>
        <CardHeader className="bg-gray-50 border-b">
          <div className="flex items-center justify-between">
            <CardTitle>Line Items</CardTitle>
            <div className="flex gap-2">
              {isEditing && (
                <>
                  <Button variant="outline" onClick={handleCancelChanges}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveChanges}
                    className="bg-green-600 hover:bg-green-700 text-white"
                    disabled={updateEstimateMutation.isPending}
                  >
                    {updateEstimateMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </Button>
                </>
              )}
              <div className="relative w-80">
                <ItemDropdown
                  value=""
                  onSelect={(item) => handleAddItem(item)}
                  placeholder="Add Item - Start typing..."
                />
              </div>
              <Button onClick={() => handleAddItem()} variant="outline">
                <Plus className="w-4 h-4 mr-2" />
                Blank Line
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={`${colorSchemes[colorScheme]} text-white`}>
                <tr>
                  <th className="text-left p-3 font-semibold">Code</th>
                  <th className="text-left p-3 font-semibold">Description</th>
                  <th className="text-right p-3 font-semibold">Quantity</th>
                  <th className="text-center p-3 font-semibold">Unit</th>
                  <th className="text-right p-3 font-semibold">Unit Price</th>
                  {showTaxBreakdown && <th className="text-right p-3 font-semibold">Tax</th>}
                  {showDepreciation && <th className="text-right p-3 font-semibold">{format?.depreciation_label || 'Depr.'}</th>}
                  <th className="text-right p-3 font-semibold">Total</th>
                  <th className="text-center p-3 font-semibold w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="p-3">
                      <code className="text-blue-600 font-mono font-semibold text-xs">
                        {item.code || '-'}
                      </code>
                    </td>
                    <td className="p-3">
                      <ItemDropdown
                        value={item.description}
                        onSelect={(selectedItem) => handleSelectItemForRow(index, selectedItem)}
                        onInputChange={(value) => handleUpdateItem(index, 'description', value)}
                        placeholder="Search or type..."
                        className="w-full"
                      />
                    </td>
                    <td className="p-3 text-right">
                      <Input
                        type="number"
                        step="0.01"
                        value={item.quantity || ""}
                        onChange={(e) => handleUpdateItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                        className="text-right w-20 ml-auto"
                      />
                    </td>
                    <td className="text-center p-3">
                      <Input
                        type="text"
                        value={item.unit || ""}
                        onChange={(e) => handleUpdateItem(index, 'unit', e.target.value)}
                        className="text-center w-16 mx-auto"
                      />
                    </td>
                    <td className="p-3 text-right">
                      <Input
                        type="number"
                        step="0.01"
                        value={item.rate || ""}
                        onChange={(e) => handleUpdateItem(index, 'rate', parseFloat(e.target.value) || 0)}
                        className="text-right w-24 ml-auto"
                      />
                    </td>
                    {showTaxBreakdown && (
                      <td className="text-right p-3 text-gray-600">
                        ${Number(((Number(item.rate) || 0) * (Number(item.quantity) || 0) * taxRate) || 0).toFixed(2)}
                      </td>
                    )}
                    {showDepreciation && <td className="text-right p-3">$0.00</td>}
                    <td className="text-right p-3 font-semibold text-green-600">
                      ${Number(item.amount || 0).toFixed(2)}
                    </td>
                    <td className="text-center p-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteItem(index)}
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={showDepreciation ? 9 : 8} className="p-8 text-center text-gray-500">
                      No line items yet - use "Add Item" above to get started
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader className="bg-blue-50 border-b">
          <CardTitle>Estimate Summary</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-3 max-w-md ml-auto">
            <div className="flex justify-between text-lg">
              <span className="font-medium">Line Item Total:</span>
              <span className="font-semibold">${subtotal.toFixed(2)}</span>
            </div>

            {/* Tax with Override Option */}
            {showTaxBreakdown && (
              <div className="flex justify-between items-center text-gray-600">
                <div className="flex items-center gap-2">
                  <span>Material Sales Tax:</span>
                  {allowTaxOverride ? (
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={customTaxRate !== null ? customTaxRate : 0} // Display 0 if customTaxRate is null (means no format tax set)
                      onChange={(e) => setCustomTaxRate(e.target.value === '' ? null : parseFloat(e.target.value))}
                      className="w-20 h-8 text-xs text-right"
                      placeholder="%"
                    />
                  ) : (
                    <span>@ {(taxRate * 100).toFixed(1)}%</span>
                  )}
                </div>
                <span>${tax.toFixed(2)}</span>
              </div>
            )}

            {showRcvAcv && (
              <div className="flex justify-between text-xl font-bold text-green-600 pt-3 border-t-2">
                <span>{format?.rcv_label || 'Replacement Cost Value (RCV)'}:</span>
                <span>${rcv.toFixed(2)}</span>
              </div>
            )}
            {estimate.notes && (
              <div className="pt-4 border-t mt-4">
                <p className="text-sm font-semibold text-gray-700 mb-2">Notes:</p>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{estimate.notes}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {format?.show_trade_summary && (
        <Card>
          <CardHeader className="bg-gray-50 border-b">
            <CardTitle>Trade Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    <th className="text-left p-3 font-semibold">Trade</th>
                    <th className="text-right p-3 font-semibold">RCV</th>
                  </tr>
                </thead>
                <tbody>
                  {/* This needs to be dynamic based on item categories, currently a placeholder */}
                  <tr className="border-b">
                    <td className="p-3 font-medium">ROOFING</td>
                    <td className="text-right p-3 font-semibold text-green-600">${rcv.toFixed(2)}</td>
                  </tr>
                  <tr className="bg-blue-50 font-bold">
                    <td className="p-3">TOTAL</td>
                    <td className="text-right p-3 text-green-600">${rcv.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {format?.footer_text && (
        <Card>
          <CardContent className="bg-gray-100 p-4">
            <p className="text-xs text-gray-600">{format.footer_text}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
