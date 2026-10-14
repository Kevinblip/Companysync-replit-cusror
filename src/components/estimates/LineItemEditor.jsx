import React, { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, GripVertical, Info, Code2, AlertCircle, EyeOff, Eye } from "lucide-react";
import ItemBrowser from "./ItemBrowser";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  applyPerLineOverheadProfit,
  calculatePerLineOverheadProfit,
  getOverheadProfitBase,
  getOpLineType,
  hasPerLineOverheadProfit,
  isOverheadProfitLine,
} from "@/utils/estimateOpLineItems";
import { resolveStoredAcv, sumNetAcv } from "@/utils/estimateTotals";

const VALID_UNITS = [
  'EA', 'SQ', 'LF', 'SY', 'SF', 'SQFT', 'FT', 'GAL', 'LB', 'BOX', 'CS', 'PAIR', 
  'SET', 'ROLL', 'SHEET', 'KIT', 'EACH', 'FOOT', 'SQUARE', 'YARD', 'GALLON',
  'POUND', 'CARTON', 'CASE', 'BUNDLE'
];

function LineItemEditor({
  items = [],
  onChange,
  format = {},
  isInsuranceJob = false,
  acvAdjustment = 0,
  lineNotes = [],
}) {
  const [editingCell, setEditingCell] = useState(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [activeAutocomplete, setActiveAutocomplete] = useState(null);
  const [autocompleteSearch, setAutocompleteSearch] = useState("");
  const [activeCodeAutocomplete, setActiveCodeAutocomplete] = useState(null);
  const [codeAutocompleteSearch, setCodeAutocompleteSearch] = useState("");
  const [buildingCodeSearch, setBuildingCodeSearch] = useState("");
  const [showDescriptionDialog, setShowDescriptionDialog] = useState(false);
  const [selectedDescription, setSelectedDescription] = useState("");
  const [showColorBrand, setShowColorBrand] = useState(false);
  const [expandedDescriptions, setExpandedDescriptions] = useState({});
  const codeDropdownRef = React.useRef(null);

  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (codeDropdownRef.current && !codeDropdownRef.current.contains(event.target)) {
        setActiveCodeAutocomplete(null);
        setBuildingCodeSearch("");
      }
    };

    if (activeCodeAutocomplete !== null) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeCodeAutocomplete]);

  const { data: allPriceListItems = [] } = useQuery({
    queryKey: ['all-price-list-items'],
    queryFn: () => base44.entities.PriceListItem.list("-created_date", 50000),
  });

  const { data: buildingCodes = [] } = useQuery({
    queryKey: ['building-codes'],
    queryFn: () => base44.entities.BuildingCode.list("-created_date", 1000),
  });

  // Get header color based on format color_scheme
  const getHeaderColor = () => {
    const colorScheme = format?.color_scheme || 'blue';
    const colorMap = {
      red: 'bg-red-600',
      green: 'bg-green-600',
      blue: 'bg-blue-600',
      gray: 'bg-gray-600'
    };
    return colorMap[colorScheme] || colorMap.blue;
  };

  const getAccentColor = () => {
    const colorScheme = format?.color_scheme || 'blue';
    const colorMap = {
      red: 'text-red-600',
      green: 'text-green-600',
      blue: 'text-blue-600',
      gray: 'text-gray-600'
    };
    return colorMap[colorScheme] || colorMap.blue;
  };

  const formatNumberForInput = (value) => {
    const num = Number(value) || 0;
    return parseFloat(num.toFixed(4)).toString();
  };

  const sanitizeUnit = (value) => {
    // Only allow alphanumeric and common unit symbols
    const sanitized = value.toUpperCase().replace(/[^A-Z0-9\s\-/]/g, '').trim();
    // Limit to 10 characters to prevent overflow in prints
    return sanitized.substring(0, 10);
  };

  const isValidUnit = (unit) => {
    const normalized = unit.toUpperCase().trim();
    return VALID_UNITS.includes(normalized);
  };

  const handleCellChange = (index, field, value) => {
    const newItems = [...items];
    
    // Validate and sanitize unit field
    if (field === 'unit') {
      value = sanitizeUnit(value);
      if (!isValidUnit(value) && value.length > 0) {
        console.warn(`⚠️ Invalid unit: "${value}". Valid units: ${VALID_UNITS.join(', ')}`);
      }
    }
    
    newItems[index] = { ...newItems[index], [field]: value };

    if (field === 'quantity' || field === 'rate') {
      const qty = parseFloat(newItems[index].quantity) || 0;
      const rate = parseFloat(newItems[index].rate) || 0;
      newItems[index].rcv = qty * rate;
      newItems[index].amount = qty * rate;
    }

    const formatShowsOp = format?.show_op_column === true && !isInsuranceJob;
    const item = newItems[index];
    if (!isOverheadProfitLine(item) && (formatShowsOp || hasPerLineOverheadProfit(item))) {
      const combinedPct = Number(format?.overhead_profit_rate ?? 20) || 0;
      const baseOverride = field === 'quantity' || field === 'rate'
        ? (parseFloat(item.quantity) || 0) * (parseFloat(item.rate ?? item.unit_price) || 0)
        : undefined;
      const financials = calculatePerLineOverheadProfit(
        baseOverride === undefined ? item : { ...item, op_base_rcv: baseOverride },
        {
          overheadPct: Number(format?.overhead_pct ?? combinedPct / 2),
          profitPct: Number(format?.profit_pct ?? combinedPct / 2),
          taxRate: Number(format?.tax_rate ?? 0) || 0,
        },
      );
      newItems[index] = {
        ...item,
        op_base_rcv: financials.base,
        op_tax_amount: financials.tax,
        overhead_amount: financials.overhead,
        profit_amount: financials.profit,
        op_amount: financials.op,
        op_overhead_pct: combinedPct / 2,
        op_profit_pct: combinedPct / 2,
        rcv: financials.rcv,
        amount: financials.rcv,
        acv: financials.acv,
      };
    } else if (field === 'depreciation_percent') {
      const depPercent = parseFloat(value) || 0;
      newItems[index].acv = newItems[index].rcv * (1 - depPercent / 100);
    }

    onChange(newItems);
  };

  const handleSelectAutocompleteItem = (index, selectedItem) => {
    const newItems = [...items];
    const price = Number(selectedItem.price) || 0;
    const qty = Number(newItems[index].quantity) || 1;
    
    newItems[index] = {
      ...newItems[index],
      code: selectedItem.code || selectedItem.sku || '',
      description: selectedItem.description || selectedItem.name || '',
      long_description: selectedItem.long_description || '',
      unit: selectedItem.unit || 'EA',
      rate: price,
      rcv: price * qty,
      acv: price * qty,
      amount: price * qty,
      color: selectedItem.color || '',
      brand: selectedItem.brand || '',
    };
    onChange(showOpColumn ? applyPerLineOverheadProfit(newItems, {
      overheadPct: overheadPercent,
      profitPct: profitPercent,
      taxRate: taxRate * 100,
    }).items : newItems);
    setActiveAutocomplete(null);
    setAutocompleteSearch("");
  };

  const filteredAutocompleteItems = useMemo(() => {
    if (!autocompleteSearch || autocompleteSearch.length < 2) return [];
    const searchLower = autocompleteSearch.toLowerCase();
    return allPriceListItems
      .filter(item =>
        item.code?.toLowerCase().includes(searchLower) ||
        item.sku?.toLowerCase().includes(searchLower) ||
        item.description?.toLowerCase().includes(searchLower) ||
        item.name?.toLowerCase().includes(searchLower)
      )
      .slice(0, 10);
  }, [autocompleteSearch, allPriceListItems]);

  const getFilteredAutocompleteItems = () => filteredAutocompleteItems;

  const getFilteredCodeAutocomplete = (search) => {
    if (!search) return buildingCodes;
    
    const searchLower = search.toLowerCase();
    return buildingCodes.filter(code => 
      code.code?.toLowerCase().includes(searchLower) ||
      code.description?.toLowerCase().includes(searchLower)
    );
  };

  const handleDeleteRow = (index) => {
    const newItems = items.filter((_, i) => i !== index);
    onChange(newItems);
  };

  const handleAddRow = () => {
    const newItem = {
      line: items.length + 1,
      code: '',
      description: '',
      long_description: '',
      quantity: 0,
      unit: 'EA',
      rate: 0,
      rcv: 0,
      acv: 0,
      amount: 0,
      depreciation: 0,
      depreciation_percent: 0,
      color: '',
      brand: ''
    };
    const nextItems = [...items, newItem];
    onChange(showOpColumn ? applyPerLineOverheadProfit(nextItems, {
      overheadPct: overheadPercent,
      profitPct: profitPercent,
      taxRate: taxRate * 100,
    }).items : nextItems);
  };

  const handleItemSelect = (selectedItem) => {
    const price = Number(selectedItem.price) || 0;
    
    const newItem = {
      line: items.length + 1,
      code: selectedItem.code || selectedItem.sku || '',
      description: selectedItem.description || selectedItem.name || '',
      long_description: selectedItem.long_description || '',
      quantity: 1,
      unit: selectedItem.unit || 'EA',
      rate: price,
      rcv: price,
      acv: price,
      amount: price,
      depreciation: 0,
      depreciation_percent: 0,
      color: selectedItem.color || '',
      brand: selectedItem.brand || ''
    };
    const nextItems = [...items, newItem];
    onChange(showOpColumn ? applyPerLineOverheadProfit(nextItems, {
      overheadPct: overheadPercent,
      profitPct: profitPercent,
      taxRate: taxRate * 100,
    }).items : nextItems);
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;

    const reorderedItems = Array.from(items);
    const [removed] = reorderedItems.splice(result.source.index, 1);
    reorderedItems.splice(result.destination.index, 0, removed);

    const updatedItems = reorderedItems.map((item, index) => ({
      ...item,
      line: index + 1
    }));

    onChange(updatedItems);
  };

  // A missing format is the normal retail estimate.  Do not let it inherit
  // insurance labels/columns just because line items retain `rcv` internally
  // for compatibility with imported carrier estimates.
  const isInsuranceFormat = format?.category === 'insurance';
  const showRcvAcv = format?.show_rcv_acv === true
    || (isInsuranceFormat && format?.show_rcv_acv !== false);
  const showDepreciation = showRcvAcv && format?.show_depreciation === true;
  const showOpColumn = format?.show_op_column === true && !isInsuranceJob;
  const opPercent = showOpColumn ? Number(format?.overhead_profit_rate ?? 20) || 0 : 0;
  const overheadPercent = showOpColumn ? Number(format?.overhead_pct ?? opPercent / 2) || 0 : 0;
  const profitPercent = showOpColumn ? Number(format?.profit_pct ?? opPercent / 2) || 0 : 0;
  const opRate = opPercent / 100;
  const taxRate = showOpColumn ? (format?.tax_rate ?? 0) / 100 : 0;

  const totalColumns = (showColorBrand ? 9 : 7) + (showOpColumn ? 2 : 0) + (showRcvAcv ? (showDepreciation ? 3 : 2) : 1);

  return (
    <div className="w-full">
      <style>{`
        @media (max-width: 768px) {
          .line-item-table {
            font-size: 14px;
          }
          .line-item-table th,
          .line-item-table td {
            padding: 8px 4px;
            min-width: 60px;
          }
          .line-item-table input {
            font-size: 14px;
            min-height: 40px;
          }
          .line-item-description-col {
            min-width: 300px;
          }
          .line-item-unit-col {
            min-width: 45px;
            max-width: 50px;
          }
          .line-item-unit-col input {
            text-align: center;
            padding: 0 2px;
            font-size: 13px;
          }
        }

        @media print {
          .line-item-table {
            border-collapse: collapse;
            width: 100%;
          }
          .line-item-table td {
            overflow: hidden;
            text-overflow: ellipsis;
            word-break: break-word;
            max-width: 100px;
          }
          .line-item-unit-col {
            max-width: 40px;
            min-width: 40px;
            word-break: break-all;
            overflow-wrap: break-word;
          }
          .line-item-unit-col input {
            max-width: 100%;
            word-break: break-all;
          }
          .line-item-description-col {
            max-width: 250px;
            word-wrap: break-word;
            overflow-wrap: break-word;
            word-break: break-word;
          }
          .line-item-table input {
            border: none;
            padding: 0;
            font-size: 10px;
          }
        }
      `}</style>

      {showBrowser && (
        <ItemBrowser
          onSelect={handleItemSelect}
          onClose={() => setShowBrowser(false)}
        />
      )}

      <TooltipProvider>
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <table className="w-full border-collapse line-item-table">
            <thead>
              <tr className={`${getHeaderColor()} text-white border-b`}>
                <th className="px-2 py-3 text-left text-xs md:text-sm font-semibold w-8 md:w-10"></th>
                <th className="px-2 py-3 text-left text-xs md:text-sm font-semibold w-10 md:w-12">#</th>
                <th className="px-2 py-3 text-left text-xs md:text-sm font-semibold" style={{minWidth: '120px'}}>Code</th>
                <th className="px-4 py-3 text-left text-xs md:text-sm font-semibold line-item-description-col">
                  <div className="flex items-center gap-2">
                    Description
                    <button
                      type="button"
                      onClick={() => setShowColorBrand(v => !v)}
                      className="ml-auto opacity-70 hover:opacity-100 flex items-center gap-1 text-xs font-normal bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded transition-colors"
                      title={showColorBrand ? "Hide Color & Brand" : "Show Color & Brand"}
                    >
                      {showColorBrand ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      {showColorBrand ? 'Hide' : 'Color/Brand'}
                    </button>
                  </div>
                </th>
                {showColorBrand && <th className="px-2 py-3 text-left text-xs md:text-sm font-semibold" style={{minWidth: '100px'}}>Color</th>}
                {showColorBrand && <th className="px-2 py-3 text-left text-xs md:text-sm font-semibold" style={{minWidth: '100px'}}>Brand</th>}
                <th className="px-2 py-3 text-right text-xs md:text-sm font-semibold" style={{minWidth:'72px'}}>Qty</th>
                <th className="px-2 py-3 text-center text-xs md:text-sm font-semibold line-item-unit-col" style={{minWidth:'58px'}}>Unit</th>
                <th className="px-2 py-3 text-right text-xs md:text-sm font-semibold" style={{minWidth:'88px'}}>Rate</th>
                {showOpColumn && (
                  <>
                    <th className="px-2 py-3 text-right text-xs md:text-sm font-semibold">Tax</th>
                    <th className="px-2 py-3 text-right text-xs md:text-sm font-semibold text-orange-200">O&P</th>
                  </>
                )}
                {showRcvAcv && (
                  <>
                    <th className="px-2 py-3 text-right text-xs md:text-sm font-semibold">
                      {format?.rcv_label || 'RCV'}
                    </th>
                    {showDepreciation && (
                      <th className="px-2 py-3 text-right text-xs md:text-sm font-semibold">Dep %</th>
                    )}
                    <th className="px-2 py-3 text-right text-xs md:text-sm font-semibold">
                      {format?.acv_label || 'ACV'}
                    </th>
                  </>
                )}
                {!showRcvAcv && (
                  <th className="px-2 py-3 text-right text-xs md:text-sm font-semibold">
                    {showOpColumn ? 'Total' : 'Amount'}
                  </th>
                )}
                <th className="px-2 py-3 text-center text-xs md:text-sm font-semibold w-12 md:w-16"></th>
              </tr>
            </thead>
            <DragDropContext onDragEnd={handleDragEnd}>
              <Droppable droppableId="line-items">
                {(provided) => (
                  <tbody {...provided.droppableProps} ref={provided.innerRef}>
                    {items.map((item, index) => {
                      const qty = Number(item.quantity) || 0;
                      const rate = Number(item.rate ?? item.unit_price) || 0;
                      const opLineType = getOpLineType(item);
                      const lineFinancials = showOpColumn && !opLineType
                        ? calculatePerLineOverheadProfit(item, {
                            overheadPct: overheadPercent,
                            profitPct: profitPercent,
                            taxRate: taxRate * 100,
                          })
                        : null;
                      const amount = opLineType
                        ? (Number(item.rcv) || Number(item.amount) || 0)
                        : (lineFinancials?.base ?? (Number(item.amount) || (qty * rate)));
                      const depPercent = Number(item.depreciation_percent) || 0;
                      const itemTax = lineFinancials?.tax || 0;
                      const itemOp = lineFinancials?.op || 0;
                      const rcv = showOpColumn
                        ? (opLineType ? amount : lineFinancials.rcv)
                        : (Number(item.rcv) || 0);
                      const acv = showOpColumn
                        ? (opLineType ? rcv * (1 - depPercent / 100) : lineFinancials.acv)
                        : resolveStoredAcv(item);

                      return (
                        <React.Fragment key={`item-${index}`}>
                          <Draggable draggableId={`item-${index}`} index={index}>
                            {(provided, snapshot) => (
                              <tr
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={`${!item.long_description ? 'border-b' : ''} hover:bg-gray-50 ${snapshot.isDragging ? 'bg-blue-50' : ''}`}
                              >
                                <td className="px-2 py-2" {...provided.dragHandleProps}>
                                  <GripVertical className="w-5 h-5 md:w-4 md:h-4 text-gray-400 cursor-move" />
                                </td>
                                <td className="px-2 py-2 text-sm md:text-base text-gray-600 font-medium">{index + 1}</td>
                                <td className="px-2 py-2 relative">
                                  <div className="flex items-center gap-1">
                                    <Input
                                      value={item.code || ''}
                                      data-testid={`input-lineitem-code-${index}`}
                                      onChange={(e) => {
                                        handleCellChange(index, 'code', e.target.value);
                                      }}
                                      className="text-sm md:text-base min-h-[40px] md:h-9 font-mono"
                                      placeholder="Type RFG..."
                                    />
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 flex-shrink-0"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            setActiveCodeAutocomplete(index);
                                            setBuildingCodeSearch('');
                                          }}
                                        >
                                          <Code2 className="w-4 h-4 text-blue-600" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Browse Building Codes</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>

                                  {activeCodeAutocomplete === index && (
                                    <div 
                                      ref={codeDropdownRef}
                                      className="absolute z-50 w-96 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 left-0"
                                    >
                                      <div className="sticky top-0 bg-white p-2 border-b">
                                        <Input
                                          placeholder="Search building codes..."
                                          value={buildingCodeSearch}
                                          onChange={(e) => setBuildingCodeSearch(e.target.value)}
                                          className="text-sm"
                                          autoFocus
                                        />
                                      </div>
                                      <div className="overflow-y-auto max-h-64">
                                        {getFilteredCodeAutocomplete(buildingCodeSearch).length > 0 ? (
                                          getFilteredCodeAutocomplete(buildingCodeSearch).map((buildingCode, idx) => (
                                            <button
                                              key={idx}
                                              type="button"
                                              onMouseDown={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                
                                                const currentDesc = items[index].long_description || '';
                                                const newCode = buildingCode.code || '';
                                                const newLongDesc = buildingCode.description 
                                                  ? (currentDesc ? `${currentDesc}\n\n${buildingCode.description}` : buildingCode.description)
                                                  : currentDesc;
                                                
                                                // Update code field first
                                                handleCellChange(index, 'code', newCode);
                                                
                                                // Then update long_description
                                                const updatedItems = [...items];
                                                updatedItems[index] = {
                                                  ...updatedItems[index],
                                                  code: newCode,
                                                  long_description: newLongDesc
                                                };
                                                onChange(updatedItems);
                                                
                                                setActiveCodeAutocomplete(null);
                                                setBuildingCodeSearch("");
                                              }}
                                              className="w-full px-3 py-3 hover:bg-blue-50 cursor-pointer border-b last:border-b-0 text-left"
                                            >
                                              <div className="flex items-start gap-3">
                                                <div className="flex-shrink-0">
                                                  <code className="text-sm font-bold text-blue-600 bg-blue-100 px-2 py-1 rounded">
                                                    {buildingCode.code}
                                                  </code>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                  <div className="text-xs text-gray-700 line-clamp-2">
                                                    {buildingCode.description?.substring(0, 120)}...
                                                  </div>
                                                </div>
                                                </div>
                                                </button>
                                                ))
                                        ) : (
                                          <div className="px-3 py-2 text-sm text-gray-500 text-center">
                                            No codes found
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-2 relative" style={{minWidth: showColorBrand ? '180px' : '260px'}}>
                                  {expandedDescriptions[index] ? (
                                    <textarea
                                      autoFocus
                                      data-testid={`textarea-lineitem-description-${index}`}
                                      value={item.description || ''}
                                      onChange={(e) => {
                                        handleCellChange(index, 'description', e.target.value);
                                        setAutocompleteSearch(e.target.value);
                                        setActiveAutocomplete(index);
                                      }}
                                      onBlur={() => {
                                        setTimeout(() => {
                                          setActiveAutocomplete(null);
                                          setExpandedDescriptions(prev => { const n = {...prev}; delete n[index]; return n; });
                                        }, 200);
                                      }}
                                      rows={3}
                                      className="w-full text-sm md:text-base px-3 py-2 border border-blue-400 rounded-md shadow-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white z-10 relative"
                                      placeholder="Type to search..."
                                    />
                                  ) : (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Input
                                          value={item.description || ''}
                                          data-testid={`input-lineitem-description-${index}`}
                                          onChange={(e) => {
                                            handleCellChange(index, 'description', e.target.value);
                                            setAutocompleteSearch(e.target.value);
                                            setActiveAutocomplete(index);
                                          }}
                                          onFocus={() => {
                                            setExpandedDescriptions(prev => ({ ...prev, [index]: true }));
                                            setActiveAutocomplete(index);
                                            setAutocompleteSearch(item.description || '');
                                          }}
                                          onBlur={() => {
                                            setTimeout(() => setActiveAutocomplete(null), 200);
                                          }}
                                          className="text-sm md:text-base min-h-[40px] md:h-9 px-3 py-2 cursor-text"
                                          placeholder="Click to edit..."
                                          readOnly
                                        />
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-md">
                                        <p className="text-sm">{item.description || 'Click to edit description'}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                  {lineNotes.filter(note => note.keywords.some(keyword => (item.description || '').toLowerCase().includes(keyword))).map(note => (
                                    <p key={note.text} className="mt-1 text-[11px] leading-snug text-amber-800" data-testid="line-scope-note">{note.text}</p>
                                  ))}
                                  
                                  {activeAutocomplete === index && autocompleteSearch.length >= 2 && (
                                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                                      {getFilteredAutocompleteItems(autocompleteSearch).length > 0 ? (
                                        getFilteredAutocompleteItems(autocompleteSearch).map((priceItem, idx) => {
                                          const itemPrice = Number(priceItem.price) || 0;
                                          return (
                                            <div
                                              key={idx}
                                              onClick={() => handleSelectAutocompleteItem(index, priceItem)}
                                              className="px-3 py-3 hover:bg-blue-50 cursor-pointer border-b last:border-b-0"
                                            >
                                              <div className="flex items-center justify-between">
                                                <div className="flex-1">
                                                  <div className="font-semibold text-sm md:text-base text-blue-600">{priceItem.code || priceItem.sku}</div>
                                                  <div className="text-xs md:text-sm text-gray-700">{priceItem.description || priceItem.name}</div>
                                                </div>
                                                <div className="text-right ml-2">
                                                  <div className="text-xs text-gray-500">{priceItem.unit}</div>
                                                  <div className="text-sm md:text-base font-bold text-green-600">${itemPrice.toFixed(2)}</div>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })
                                      ) : (
                                        <div className="px-3 py-2 text-sm text-gray-500 text-center">
                                          No items found
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </td>
                                {showColorBrand && (
                                  <td className="px-2 py-2">
                                    <Input
                                      value={item.color || ''}
                                      onChange={(e) => handleCellChange(index, 'color', e.target.value)}
                                      className="text-sm md:text-base min-h-[40px] md:h-9"
                                      placeholder="e.g., Black"
                                    />
                                  </td>
                                )}
                                {showColorBrand && (
                                  <td className="px-2 py-2">
                                    <Input
                                      value={item.brand || ''}
                                      onChange={(e) => handleCellChange(index, 'brand', e.target.value)}
                                      className="text-sm md:text-base min-h-[40px] md:h-9"
                                      placeholder="e.g., CertainTeed"
                                    />
                                  </td>
                                )}
                                <td className="px-2 py-2" style={{minWidth:'72px'}}>
                                  <Input
                                    type="text"
                                    inputMode="decimal"
                                    data-testid={`input-lineitem-qty-${index}`}
                                    value={item.quantity != null && item.quantity !== '' ? String(item.quantity) : '0'}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) => handleCellChange(index, 'quantity', e.target.value)}
                                    onBlur={(e) => {
                                      const parsed = parseFloat(e.target.value);
                                      if (!isNaN(parsed)) handleCellChange(index, 'quantity', parsed);
                                    }}
                                    className="text-sm md:text-base min-h-[40px] md:h-9 text-right font-medium w-full"
                                  />
                                  {item.import_only && (Number(item.quantity) || 0) === 0 && (
                                    <span
                                      className="block mt-0.5 text-center text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 leading-tight"
                                      title="Qty not shown in PDF — RCV total is correct"
                                    >
                                      PDF total
                                    </span>
                                  )}
                                </td>
                                <td className="px-2 py-2 line-item-unit-col" style={{minWidth:'58px'}}>
                                  <Input
                                    value={item.unit && item.unit.trim() ? item.unit.trim() : 'EA'}
                                    data-testid={`input-lineitem-unit-${index}`}
                                    onChange={(e) => handleCellChange(index, 'unit', e.target.value)}
                                    className="text-sm md:text-base min-h-[40px] md:h-9 text-center w-full"
                                  />
                                </td>
                                <td className="px-2 py-2" style={{minWidth:'88px'}}>
                                  <Input
                                    type="text"
                                    inputMode="decimal"
                                    data-testid={`input-lineitem-rate-${index}`}
                                    value={(() => { const r = item.rate ?? item.unit_price; return r != null && r !== '' ? String(r) : '0'; })()}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) => handleCellChange(index, 'rate', e.target.value)}
                                    onBlur={(e) => {
                                      const parsed = parseFloat(e.target.value);
                                      if (!isNaN(parsed)) handleCellChange(index, 'rate', parsed);
                                    }}
                                    className="text-sm md:text-base min-h-[40px] md:h-9 text-right font-medium w-full"
                                  />
                                  {item.import_only && (Number(item.rate ?? item.unit_price) || 0) === 0 && (
                                    <span
                                      className="block mt-0.5 text-center text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 leading-tight"
                                      title="Unit price not shown in PDF — RCV total is correct"
                                    >
                                      PDF total
                                    </span>
                                  )}
                                </td>
                                {showOpColumn && (
                                  <>
                                    <td className="px-2 py-2 text-right text-sm md:text-base text-gray-600">
                                      ${itemTax.toFixed(2)}
                                    </td>
                                    <td className="px-2 py-2 text-right text-sm md:text-base font-medium text-orange-600">
                                      ${itemOp.toFixed(2)}
                                    </td>
                                  </>
                                )}
                                {showRcvAcv && (
                                  <>
                                    <td className="px-2 py-2 text-right text-sm md:text-base font-bold text-gray-900">
                                      ${rcv.toFixed(2)}
                                    </td>
                                    {showDepreciation && (
                                      <td className="px-2 py-2">
                                        <Input
                                          type="text"
                                          inputMode="decimal"
                                          value={item.depreciation_percent !== undefined && item.depreciation_percent !== null ? String(item.depreciation_percent) : ''}
                                          onFocus={(e) => e.target.select()}
                                          onChange={(e) => handleCellChange(index, 'depreciation_percent', e.target.value)}
                                          onBlur={(e) => {
                                            const parsed = parseFloat(e.target.value);
                                            if (!isNaN(parsed)) handleCellChange(index, 'depreciation_percent', parsed);
                                          }}
                                          className="text-sm md:text-base min-h-[40px] md:h-9 text-right"
                                        />
                                      </td>
                                    )}
                                    <td className="px-2 py-2 text-right text-sm md:text-base font-bold text-green-600">
                                      ${acv.toFixed(2)}
                                    </td>
                                  </>
                                )}
                                {!showRcvAcv && (
                                  <td className="px-2 py-2 text-right text-sm md:text-base font-bold text-gray-900">
                                    ${(showOpColumn ? rcv : amount).toFixed(2)}
                                  </td>
                                )}
                                <td className="px-2 py-2 text-center">
                                  <div className="flex gap-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => {
                                        setSelectedDescription(item.description || 'No description');
                                        setShowDescriptionDialog(true);
                                      }}
                                      className="h-10 w-10 md:hidden text-blue-500 hover:text-blue-700 hover:bg-blue-50"
                                    >
                                      <Info className="w-5 h-5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleDeleteRow(index)}
                                      className="h-10 w-10 md:h-8 md:w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                                    >
                                      <Trash2 className="w-5 h-5 md:w-4 md:h-4" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Draggable>
                          {item.long_description && (
                            <tr className="border-b bg-gray-50">
                              <td colSpan="3" className="px-2 py-2"></td>
                              <td colSpan={totalColumns - 3} className="px-2 py-2">
                                <Input
                                  value={item.long_description || ''}
                                  onChange={(e) => handleCellChange(index, 'long_description', e.target.value)}
                                  className="text-sm italic text-gray-700 bg-white border-gray-300"
                                  placeholder="Additional notes..."
                                />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {provided.placeholder}
                  </tbody>
                )}
              </Droppable>
            </DragDropContext>
          </table>
        </div>
      </TooltipProvider>

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <Button
          onClick={handleAddRow}
          variant="outline"
          size="sm"
          data-testid="button-add-blank-row"
          className="flex items-center justify-center gap-2 min-h-[44px] text-base"
        >
          <Plus className="w-5 h-5" />
          Add Blank Row
        </Button>
        
        <Button
          onClick={() => setShowBrowser(true)}
          variant="default"
          size="sm"
          className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 min-h-[44px] text-base"
        >
          <Plus className="w-5 h-5" />
          Browse Items
        </Button>
      </div>

      {items.length > 0 && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg">
          <div className="flex justify-end">
            {showOpColumn ? (() => {
              const detailItems = items.filter(item => !getOpLineType(item));
              const detailFinancials = detailItems.map(item => calculatePerLineOverheadProfit(item, {
                overheadPct: overheadPercent,
                profitPct: profitPercent,
                taxRate: taxRate * 100,
              }));
              const explicitOpItems = items.filter(item => getOpLineType(item));
              const totalBase = getOverheadProfitBase(items);
              const totalTaxAmt = detailFinancials.reduce((sum, financials) => sum + financials.tax, 0);
              const totalOpAmt = detailFinancials.reduce((sum, financials) => sum + financials.op, 0)
                + explicitOpItems.reduce((sum, item) => sum + (Number(item.rcv) || Number(item.amount) || 0), 0);
              const totalRcvAmt = detailFinancials.reduce((sum, financials) => sum + financials.rcv, 0)
                + explicitOpItems.reduce((sum, item) => sum + (Number(item.rcv) || Number(item.amount) || 0), 0);
               const totalAcvAmt = Math.max(0, detailFinancials.reduce((sum, financials) => sum + financials.acv, 0)
                + explicitOpItems.reduce((sum, item) => {
                  const rcv = Number(item.rcv) || Number(item.amount) || 0;
                  const dep = Number(item.depreciation_percent) || 0;
                  return sum + rcv * (1 - dep / 100);
                 }, 0) - (Number(acvAdjustment) || 0));
              return (
               <div className="text-right space-y-1">
                  <div className="flex justify-between gap-4 md:gap-8 text-sm text-gray-600">
                    <span>Subtotal:</span>
                    <span className="font-medium">${totalBase.toFixed(2)}</span>
                  </div>
                  {taxRate > 0 && (
                    <div className="flex justify-between gap-4 md:gap-8 text-sm text-gray-600">
                      <span>Total Tax ({(taxRate * 100).toFixed(1)}%):</span>
                      <span className="font-medium">${totalTaxAmt.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-4 md:gap-8 text-sm text-orange-600">
                    <span>Total O&P ({opPercent.toFixed(0)}%):</span>
                    <span className="font-medium">${totalOpAmt.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between gap-4 md:gap-8 border-t pt-1">
                    <span className="text-sm md:text-base font-medium text-gray-600">
                       {showRcvAcv ? (format?.rcv_label || 'Total RCV') : 'Total'}:
                    </span>
                    <span className="text-lg md:text-xl font-bold text-gray-900">${totalRcvAmt.toFixed(2)}</span>
                  </div>
                  {showRcvAcv && showDepreciation && (
                    <div className="flex justify-between gap-4 md:gap-8">
                     <span className="text-sm md:text-base font-medium text-gray-600">
                       {Number(acvAdjustment) > 0 ? 'Net ACV' : (format?.acv_label || 'Total ACV')}:
                     </span>
                      <span className="text-lg md:text-xl font-bold text-green-600">${totalAcvAmt.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              );
            })() : showRcvAcv ? (
              <div className="text-right space-y-2">
                <div className="flex justify-between gap-4 md:gap-8">
                  <span className="text-sm md:text-base font-medium text-gray-600">
                    {format?.rcv_label || 'Total RCV'}:
                  </span>
                  <span className="text-lg md:text-xl font-bold text-gray-900">
                    ${items.reduce((sum, item) => sum + (Number(item.rcv) || 0), 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between gap-4 md:gap-8">
                   <span className="text-sm md:text-base font-medium text-gray-600">
                     {Number(acvAdjustment) > 0 ? 'Net ACV' : (format?.acv_label || 'Total ACV')}:
                   </span>
                  <span className="text-lg md:text-xl font-bold text-green-600">
                    ${sumNetAcv(items, acvAdjustment).toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-right">
                <div className="flex justify-between gap-4 md:gap-8">
                  <span className="text-sm md:text-base font-medium text-gray-600">Subtotal:</span>
                  <span className="text-lg md:text-xl font-bold text-gray-900">
                    ${items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={showDescriptionDialog} onOpenChange={setShowDescriptionDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Full Description</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedDescription}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default React.memo(LineItemEditor, (prev, next) => {
  return (
    prev.items === next.items &&
    prev.onChange === next.onChange &&
    prev.isInsuranceJob === next.isInsuranceJob &&
    prev.format?.id === next.format?.id &&
    prev.format?.color_scheme === next.format?.color_scheme &&
    prev.format?.show_rcv_acv === next.format?.show_rcv_acv &&
    prev.format?.show_depreciation === next.format?.show_depreciation &&
    prev.format?.show_op_column === next.format?.show_op_column &&
    prev.format?.overhead_profit_rate === next.format?.overhead_profit_rate &&
    prev.format?.overhead_pct === next.format?.overhead_pct &&
    prev.format?.profit_pct === next.format?.profit_pct &&
    prev.format?.tax_rate === next.format?.tax_rate &&
    prev.format?.rcv_label === next.format?.rcv_label &&
    prev.format?.acv_label === next.format?.acv_label
  );
});