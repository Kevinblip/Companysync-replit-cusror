import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Star, CheckSquare, Square } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ItemDropdown({ onItemSelect }) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedItems, setSelectedItems] = useState(new Set());

  const { data: allPriceListItems = [] } = useQuery({
    queryKey: ['all-price-list-items'],
    queryFn: () => base44.entities.PriceListItem.list("-created_date", 10000),
    initialData: [],
  });

  const getCode = (item) => item.code || item.sku || '';
  const getDesc = (item) => item.description || item.name || '';
  const getSource = (item) => item.source || item.category || '';

  const normItem = (item) => ({ ...item, code: getCode(item), description: getDesc(item), source: getSource(item) });
  const xactimatePriceList = allPriceListItems.filter(item => item.source === "Xactimate" || item.source === "Xactimate_New").map(normItem);
  const xactimateNewPriceList = allPriceListItems.filter(item => item.source === "Xactimate_New").map(normItem);
  const customPriceList = allPriceListItems.filter(item => item.source === "Custom").map(normItem);
  const symbilityPriceList = allPriceListItems.filter(item => item.source === "Symbility").map(normItem);
  const favoritePriceList = allPriceListItems.filter(item => item.is_favorite === true).map(normItem);

  const filterItems = (items) => {
    if (!searchTerm) return items;
    const lowerSearch = searchTerm.toLowerCase();
    return items.filter(item =>
      getDesc(item).toLowerCase().includes(lowerSearch) ||
      getCode(item).toLowerCase().includes(lowerSearch)
    );
  };

  const handleSelectItem = (item) => {
    if (typeof onItemSelect === 'function') {
      onItemSelect(item);
      setOpen(false);
      setSearchTerm("");
      setSelectedItems(new Set());
    }
  };

  const handleToggleSelection = (itemId) => {
    const newSelection = new Set(selectedItems);
    if (newSelection.has(itemId)) {
      newSelection.delete(itemId);
    } else {
      newSelection.add(itemId);
    }
    setSelectedItems(newSelection);
  };

  const handleAddSelected = () => {
    const itemsToAdd = allPriceListItems.filter(item => selectedItems.has(item.id));
    itemsToAdd.forEach(item => {
      if (typeof onItemSelect === 'function') {
        onItemSelect(item);
      }
    });
    setOpen(false);
    setSearchTerm("");
    setSelectedItems(new Set());
  };

  const ItemRow = ({ item, source }) => {
    const isSelected = selectedItems.has(item.id);
    
    return (
      <div
        className={`flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer border-b transition-colors ${
          isSelected ? 'bg-blue-50' : ''
        }`}
        onClick={() => handleToggleSelection(item.id)}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleToggleSelection(item.id);
          }}
          className="flex-shrink-0"
        >
          {isSelected ? (
            <CheckSquare className="w-5 h-5 text-blue-600" />
          ) : (
            <Square className="w-5 h-5 text-gray-400" />
          )}
        </button>

        {item.is_favorite && <Star className="w-4 h-4 text-yellow-500 flex-shrink-0" fill="currentColor" />}
        
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-blue-600 text-sm">{item.code || item.sku}</p>
              <p className="text-sm text-gray-700 mt-0.5">{item.description || item.name}</p>
            </div>
            <Badge variant="outline" className="flex-shrink-0 text-xs">
              {source}
            </Badge>
          </div>
          <div className="flex items-center gap-4 mt-1">
            <span className="text-xs text-gray-500">Unit: {item.unit}</span>
            <span className="text-sm font-semibold text-green-600">${item.price?.toFixed(2)}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Browse Items
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Browse Price List Items</DialogTitle>
        </DialogHeader>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            placeholder="Search by code or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {selectedItems.size > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-blue-900">
                {selectedItems.size} item{selectedItems.size > 1 ? 's' : ''} selected
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedItems(new Set())}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  onClick={handleAddSelected}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Add {selectedItems.size} Item{selectedItems.size > 1 ? 's' : ''}
                </Button>
              </div>
            </div>
          </div>
        )}

        <Tabs defaultValue="all" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="all">
              All ({allPriceListItems.length})
            </TabsTrigger>
            <TabsTrigger value="favorites">
              <Star className="w-3 h-3 mr-1" />
              Favorites ({favoritePriceList.length})
            </TabsTrigger>
            <TabsTrigger value="xactimate">Xactimate ({xactimatePriceList.length})</TabsTrigger>
            <TabsTrigger value="xactimate_new">New ({xactimateNewPriceList.length})</TabsTrigger>
            <TabsTrigger value="custom">Custom ({customPriceList.length})</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4">
            <TabsContent value="all" className="m-0">
              {filterItems(allPriceListItems).map((item) => (
                <ItemRow key={item.id} item={item} source={item.source} />
              ))}
            </TabsContent>

            <TabsContent value="favorites" className="m-0">
              {filterItems(favoritePriceList).length > 0 ? (
                filterItems(favoritePriceList).map((item) => (
                  <ItemRow key={item.id} item={item} source={item.source} />
                ))
              ) : (
                <div className="text-center py-12 text-gray-500">
                  No favorite items yet. Star items to add them here.
                </div>
              )}
            </TabsContent>

            <TabsContent value="xactimate" className="m-0">
              {filterItems(xactimatePriceList).map((item) => (
                <ItemRow key={item.id} item={item} source="Xactimate" />
              ))}
            </TabsContent>

            <TabsContent value="xactimate_new" className="m-0">
              {filterItems(xactimateNewPriceList).map((item) => (
                <ItemRow key={item.id} item={item} source="Xactimate New" />
              ))}
            </TabsContent>

            <TabsContent value="custom" className="m-0">
              {filterItems(customPriceList).length > 0 ? (
                filterItems(customPriceList).map((item) => (
                  <ItemRow key={item.id} item={item} source="Custom" />
                ))
              ) : (
                <div className="text-center py-12 text-gray-500">
                  No custom items yet. Add items in Settings → Items.
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}