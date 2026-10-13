import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Star, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { matchesPriceListSearch } from "@/lib/priceListUtils";

const PAGE_SIZE = 150;

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function ItemBrowser({ onSelect, onClose }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("favorites");
  const queryClient = useQueryClient();

  // Debounce the search so filtering only runs 200ms after the user stops typing
  const debouncedSearch = useDebounce(searchTerm, 200);

  const { data: priceListItems = [] } = useQuery({
    queryKey: ['all-price-list-items'],
    queryFn: () => base44.entities.PriceListItem.list("-created_date", 50000),
    staleTime: 5 * 60 * 1000, // cache for 5 minutes so re-opens are instant
  });

  const getCode = (item) => item.code || item.sku || '';
  const getDesc = (item) => item.description || item.name || '';
  const getSource = (item) => item.source || item.category || '';

  // Pre-bucket items once (not on every render)
  const buckets = useMemo(() => ({
    favorites: priceListItems.filter(item => item.is_favorite),
    xactimate: priceListItems.filter(item => item.source === "Xactimate" || item.source === "Xactimate_New"),
    xactimateNew: priceListItems.filter(item => item.source === "Xactimate_New"),
    symbility: priceListItems.filter(item => (item.source || '').toLowerCase().includes('symbility')),
    custom: priceListItems.filter(item => item.source === "Custom"),
    all: priceListItems,
  }), [priceListItems]);

  const filterItems = useCallback((items) => {
    return items.filter(item => matchesPriceListSearch(item, debouncedSearch));
  }, [debouncedSearch]);

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

  const renderList = (rawItems, emptyNode) => {
    const filtered = filterItems(rawItems);
    if (filtered.length === 0) return emptyNode;
    const shown = filtered.slice(0, PAGE_SIZE);
    return (
      <>
        {filtered.length > PAGE_SIZE && (
          <div className="text-xs text-gray-500 text-center py-2 border-b bg-gray-50">
            Showing {PAGE_SIZE} of {filtered.length} results — narrow your search to see more
          </div>
        )}
        {shown.map(renderItemRow)}
      </>
    );
  };

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
            autoFocus
          />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="flex w-full overflow-x-auto h-auto p-1 gap-0.5 justify-start">
            <TabsTrigger value="favorites" className="flex items-center gap-1 whitespace-nowrap text-xs px-2 py-1.5 shrink-0">
              <Star className="w-3 h-3" />
              Favs ({buckets.favorites.length})
            </TabsTrigger>
            <TabsTrigger value="all" className="whitespace-nowrap text-xs px-2 py-1.5 shrink-0">
              All ({priceListItems.length})
            </TabsTrigger>
            <TabsTrigger value="xactimate" className="whitespace-nowrap text-xs px-2 py-1.5 shrink-0">
              Xactimate ({buckets.xactimate.length})
            </TabsTrigger>
            <TabsTrigger value="symbility" className="whitespace-nowrap text-xs px-2 py-1.5 shrink-0">
              Symbility ({buckets.symbility.length})
            </TabsTrigger>
            <TabsTrigger value="new" className="whitespace-nowrap text-xs px-2 py-1.5 shrink-0">
              New ({buckets.xactimateNew.length})
            </TabsTrigger>
            <TabsTrigger value="custom" className="whitespace-nowrap text-xs px-2 py-1.5 shrink-0">
              Custom ({buckets.custom.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="favorites" className="flex-1 overflow-y-auto mt-4">
            {renderList(buckets.favorites, (
              <div className="text-center py-12 text-gray-500">
                <Star className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                <p>No favorite items found</p>
                <p className="text-sm mt-1">Star items to add them to favorites</p>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="all" className="flex-1 overflow-y-auto mt-4">
            {renderList(buckets.all, <div className="text-center py-12 text-gray-500">No items found</div>)}
          </TabsContent>

          <TabsContent value="xactimate" className="flex-1 overflow-y-auto mt-4">
            {renderList(buckets.xactimate, <div className="text-center py-12 text-gray-500">No Xactimate items found</div>)}
          </TabsContent>

          <TabsContent value="symbility" className="flex-1 overflow-y-auto mt-4">
            {renderList(buckets.symbility, (
              <div className="text-center py-12 text-gray-500">
                <p>No Symbility items found</p>
                <p className="text-sm mt-1">Import Symbility items via Settings → Price List</p>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="new" className="flex-1 overflow-y-auto mt-4">
            {renderList(buckets.xactimateNew, <div className="text-center py-12 text-gray-500">No new items found</div>)}
          </TabsContent>

          <TabsContent value="custom" className="flex-1 overflow-y-auto mt-4">
            {renderList(buckets.custom, (
              <div className="text-center py-12 text-gray-500">
                <p>No custom items found</p>
                <p className="text-sm mt-1">Add custom items in Settings → Price List</p>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
