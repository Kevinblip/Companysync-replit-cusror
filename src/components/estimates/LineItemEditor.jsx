import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Plus, GripVertical, Info, Code2, AlertCircle } from "lucide-react";
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

const VALID_UNITS = [
  'EA', 'SQ', 'LF', 'SY', 'SF', 'SQFT', 'FT', 'GAL', 'LB', 'BOX', 'CS', 'PAIR', 
  'SET', 'ROLL', 'SHEET', 'KIT', 'EACH', 'FOOT', 'SQUARE', 'YARD', 'GALLON',
  'POUND', 'CARTON', 'CASE', 'BUNDLE'
];

export default function LineItemEditor({ items = [], onChange, format = {} }) {
  const [editingCell, setEditingCell] = useState(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [activeAutocomplete, setActiveAutocomplete] = useState(null);
  const [autocompleteSearch, setAutocompleteSearch] = useState("");
  const [activeCodeAutocomplete, setActiveCodeAutocomplete] = useState(null);
  const [codeAutocompleteSearch, setCodeAutocompleteSearch] = useState("");
  const [buildingCodeSearch, setBuildingCodeSearch] = useState("");
  const [showDescriptionDialog, setShowDescriptionDialog] = useState(false);
  const [selectedDescription, setSelectedDescription] = useState("");
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
    queryFn: () => base44.entities.PriceListItem.list("-created_date", 10000),
    initialData: [],
  });

  const { data: buildingCodes = [] } = useQuery({
    queryKey: ['building-codes'],
    queryFn: () => base44.entities.BuildingCode.list("-created_date", 1000),
    initialData: [],
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
      
      const depreciationPercent = parseFloat(newItems[index].depreciation_percent) || 0;
      newItems[index].acv = newItems[index].rcv * (1 - depreciationPercent / 100);
    }

    if (field === 'depreciation_percent') {
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
    onChange(newItems);
    setActiveAutocomplete(null);
    setAutocompleteSearch("");
  };

  const getFilteredAutocompleteItems = (search) => {
    if (!search || search.length < 2) return [];
    
    const searchLower = search.toLowerCase();
    return allPriceListItems
      .filter(item => 
        item.code?.toLowerCase().includes(searchLower) ||
        item.sku?.toLowerCase().includes(searchLower) ||
        item.description?.toLowerCase().includes(searchLower) ||
        item.name?.toLowerCase().includes(searchLower)
      )
      .slice(0, 10);
  };

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
    onChange([...items, newItem]);
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
    onChange([...items, newItem]);
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

  const showRcvAcv = format?.show_rcv_acv !== false;
  const showDepreciation = format?.show_depreciation === true;

  const totalColumns = 7 + (showRcvAcv ? (showDepreciation ? 3 : 2) : 1);

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
                <th className="px-4 py-3 text-left text-xs md:text-sm font-semibold line-item-description-col">Description</th>
                <th className="px-2 py-3 text-left text-xs md:text-sm font-semibold" style={{minWidth: '100px'}}>Color</th>
                <th className="px-2 py-3 text-left text-xs md:text-sm font-semibold" style={{minWidth: '100px'}}>Brand</th>
                <th className="px-2 py-3 text-right text-xs md:text-sm font-semibold">Qty</th>
                <th className="px-2 py-3 text-center text-xs md:text-sm font-semibold line-item-unit-col">Unit</th>
                <th className="px-2 py-3 text-right text-xs md:text-sm font-semibold">Rate</th>
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
                  <th className="px-2 py-3 text-right text-xs md:text-sm font-semibold">Amount</th>
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
                      const rate = Number(item.rate) || 0;
                      const rcv = Number(item.rcv) || 0;
                      const acv = Number(item.acv) || 0;
                      const amount = Number(item.amount) || 0;
                      const depPercent = Number(item.depreciation_percent) || 0;

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
                                <td className="px-4 py-2 relative">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Input
                                        value={item.description || ''}
                                        onChange={(e) => {
                                          handleCellChange(index, 'description', e.target.value);
                                          setAutocompleteSearch(e.target.value);
                                          setActiveAutocomplete(index);
                                        }}
                                        onFocus={() => {
                                          setActiveAutocomplete(index);
                                          setAutocompleteSearch(item.description || '');
                                        }}
                                        onBlur={() => {
                                          setTimeout(() => setActiveAutocomplete(null), 200);
                                        }}
                                        className="text-sm md:text-base min-h-[40px] md:h-9 px-3 py-2"
                                        placeholder="Type to search..."
                                      />
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-md">
                                      <p className="text-sm">{item.description || 'No description'}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                  
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
                                <td className="px-2 py-2">
                                  <Input
                                    value={item.color || ''}
                                    onChange={(e) => handleCellChange(index, 'color', e.target.value)}
                                    className="text-sm md:text-base min-h-[40px] md:h-9"
                                    placeholder="e.g., Black"
                                  />
                                </td>
                                <td className="px-2 py-2">
                                  <Input
                                    value={item.brand || ''}
                                    onChange={(e) => handleCellChange(index, 'brand', e.target.value)}
                                    className="text-sm md:text-base min-h-[40px] md:h-9"
                                    placeholder="e.g., CertainTeed"
                                  />
                                </td>
                                <td className="px-2 py-2">
                                  <Input
                                    type="text"
                                    inputMode="decimal"
                                    value={item.quantity !== undefined && item.quantity !== null ? String(item.quantity) : ''}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) => handleCellChange(index, 'quantity', e.target.value)}
                                    onBlur={(e) => {
                                      const parsed = parseFloat(e.target.value);
                                      if (!isNaN(parsed)) handleCellChange(index, 'quantity', parsed);
                                    }}
                                    className="text-sm md:text-base min-h-[40px] md:h-9 text-right font-medium"
                                  />
                                </td>
                                <td className="px-2 py-2 line-item-unit-col">
                                  <Input
                                    value={item.unit || 'EA'}
                                    onChange={(e) => handleCellChange(index, 'unit', e.target.value)}
                                    className="text-sm md:text-base min-h-[40px] md:h-9 text-center"
                                  />
                                </td>
                                <td className="px-2 py-2">
                                  <Input
                                    type="text"
                                    inputMode="decimal"
                                    value={item.rate !== undefined && item.rate !== null ? String(item.rate) : ''}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) => handleCellChange(index, 'rate', e.target.value)}
                                    onBlur={(e) => {
                                      const parsed = parseFloat(e.target.value);
                                      if (!isNaN(parsed)) handleCellChange(index, 'rate', parsed);
                                    }}
                                    className="text-sm md:text-base min-h-[40px] md:h-9 text-right font-medium"
                                  />
                                </td>
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
                                    ${amount.toFixed(2)}
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
            {showRcvAcv ? (
              <div className="text-right space-y-2">
                <div className="flex justify-between gap-4 md:gap-8">
                  <span className="text-sm md:text-base font-medium text-gray-600">{format?.rcv_label || 'Total RCV'}:</span>
                  <span className="text-lg md:text-xl font-bold text-gray-900">
                    ${items.reduce((sum, item) => sum + (Number(item.rcv) || 0), 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between gap-4 md:gap-8">
                  <span className="text-sm md:text-base font-medium text-gray-600">{format?.acv_label || 'Total ACV'}:</span>
                  <span className="text-lg md:text-xl font-bold text-green-600">
                    ${items.reduce((sum, item) => sum + (Number(item.acv) || 0), 0).toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-right">
                <div className="flex justify-between gap-4 md:gap-8">
                  <span className="text-sm md:text-base font-medium text-gray-600">Total:</span>
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