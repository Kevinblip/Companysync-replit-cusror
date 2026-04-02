import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Star, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function ItemBrowser({ onSelect, onClose }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSource, setSelectedSource] = useState("all");
  const queryClient = useQueryClient();

  const { data: priceListItems = [] } = useQuery({
    queryKey: ['all-price-list-items'],
    queryFn: () => base44.entities.PriceListItem.list("-created_date", 10000),
    initialData: [],
  });

  const getCode = (item) => item.code || item.sku || '';
  const getDesc = (item) => item.description || item.name || '';
  const getSource = (item) => item.source || item.category || '';

  const favorites = priceListItems.filter(item => item.is_favorite);
  const xactimateItems = priceListItems.filter(item => item.source === "Xactimate" || item.source === "Xactimate_New");
  const xactimateNewItems = priceListItems.filter(item => item.source === "Xactimate_New");
  const customItems = priceListItems.filter(item => item.source === "Custom");

  const getFilteredItems = (items) => {
    if (!searchTerm) return items;
    const search = searchTerm.toLowerCase();
    return items.filter(item => 
      getCode(item).toLowerCase().includes(search) ||
      getDesc(item).toLowerCase().includes(search)
    );
  };

  const handleItemClick = (item) => {
    onSelect(item);
    onClose();
  };

  const toggleFavorite = async (e, item) => {
    e.stopPropagation();
    try {
      await base44.entities.PriceListItem.update(item.id, {
        is_favorite: !item.is_favorite
      });
      // Invalidate query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['all-price-list-items'] });
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  const renderItemRow = (item) => (
    <div
      key={item.id}
      onClick={() => handleItemClick(item)}
      className="p-3 border-b hover:bg-blue-50 cursor-pointer transition-colors flex items-center justify-between group"
    >
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <button
            onClick={(e) => toggleFavorite(e, item)}
            className="hover:scale-110 transition-transform"
            title={item.is_favorite ? "Remove from favorites" : "Add to favorites"}
          >
            <Star 
              className={`w-4 h-4 ${item.is_favorite ? 'text-yellow-500 fill-yellow-500' : 'text-gray-300 group-hover:text-yellow-400'}`}
            />
          </button>
          <span className="font-semibold text-blue-600">{getCode(item)}</span>
          <Badge variant="outline" className="text-xs">
            {getSource(item)}
          </Badge>
        </div>
        <p className="text-sm text-gray-700">{getDesc(item)}</p>
      </div>
      <div className="text-right ml-4">
        <p className="text-sm text-gray-500">Unit: {item.unit}</p>
        <p className="text-lg font-bold text-green-600">${item.price?.toFixed(2) || '0.00'}</p>
      </div>
    </div>
  );

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Browse Price List Items</span>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </DialogTitle>
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

        <Tabs defaultValue="favorites" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="favorites" className="flex items-center gap-1">
              <Star className="w-3 h-3" />
              Favorites ({favorites.length})
            </TabsTrigger>
            <TabsTrigger value="all">
              All ({priceListItems.length})
            </TabsTrigger>
            <TabsTrigger value="xactimate">
              Xactimate ({xactimateItems.length})
            </TabsTrigger>
            <TabsTrigger value="new">
              New ({xactimateNewItems.length})
            </TabsTrigger>
            <TabsTrigger value="custom">
              Custom ({customItems.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="favorites" className="flex-1 overflow-y-auto mt-4">
            {getFilteredItems(favorites).length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Star className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                <p>No favorite items found</p>
                <p className="text-sm mt-1">Star items to add them to favorites</p>
              </div>
            ) : (
              getFilteredItems(favorites).map(renderItemRow)
            )}
          </TabsContent>

          <TabsContent value="all" className="flex-1 overflow-y-auto mt-4">
            {getFilteredItems(priceListItems).map(renderItemRow)}
          </TabsContent>

          <TabsContent value="xactimate" className="flex-1 overflow-y-auto mt-4">
            {getFilteredItems(xactimateItems).map(renderItemRow)}
          </TabsContent>

          <TabsContent value="new" className="flex-1 overflow-y-auto mt-4">
            {getFilteredItems(xactimateNewItems).map(renderItemRow)}
          </TabsContent>

          <TabsContent value="custom" className="flex-1 overflow-y-auto mt-4">
            {getFilteredItems(customItems).length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p>No custom items found</p>
                <p className="text-sm mt-1">Add custom items in Settings → Price List</p>
              </div>
            ) : (
              getFilteredItems(customItems).map(renderItemRow)
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}