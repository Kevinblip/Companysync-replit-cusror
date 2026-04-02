import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Star, StarOff, Plus, Upload, RefreshCw } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function XactimateBrowser({ onAddItem }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const queryClient = useQueryClient();

  const { data: priceItems = [], isLoading } = useQuery({
    queryKey: ['price-list-items'],
    queryFn: () => base44.entities.PriceListItem.list("-created_date", 1000),
    initialData: [],
  });

  const toggleFavoriteMutation = useMutation({
    mutationFn: ({ id, isFavorite }) => 
      base44.entities.PriceListItem.update(id, { is_favorite: !isFavorite }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
    },
  });

  const loadDefaultData = async () => {
    const defaultItems = [
      { code: "RFG SSSQ", description: "Remove shingles - 3 tab or dimensional", unit: "SQ", price: 125.50, category: "Roofing" },
      { code: "RFG DIM", description: "Shingles - dimensional or architectural", unit: "SQ", price: 285.75, category: "Roofing" },
      { code: "RFG 3TAB", description: "Shingles - 3 tab", unit: "SQ", price: 225.50, category: "Roofing" },
      { code: "RFG ICE", description: "Ice & water shield", unit: "SQ", price: 95.25, category: "Roofing" },
      { code: "RFG FELT", description: "Felt underlayment - #30", unit: "SQ", price: 45.00, category: "Roofing" },
      { code: "RFG DRP", description: "Drip edge", unit: "LF", price: 3.25, category: "Roofing" },
      { code: "RFG STRTR", description: "Starter strip shingles", unit: "LF", price: 2.85, category: "Roofing" },
      { code: "RFG RDG", description: "Ridge cap shingles", unit: "LF", price: 4.50, category: "Roofing" },
      { code: "RFG VLY", description: "Valley flashing - metal", unit: "LF", price: 8.75, category: "Roofing" },
      { code: "RFG VENT", description: "Roof vent - turtle/box", unit: "EA", price: 125.00, category: "Roofing" },
      { code: "RFG PIPE", description: "Pipe flashing/boot", unit: "EA", price: 45.50, category: "Roofing" },
      { code: "RFG DECK", description: "Roof decking - 1/2\" OSB", unit: "SF", price: 2.85, category: "Roofing" },
      { code: "RFG TRUSS", description: "Roof truss repair", unit: "EA", price: 450.00, category: "Roofing" },
      { code: "RFG RAFTER", description: "Roof rafter - 2x6", unit: "LF", price: 8.25, category: "Roofing" },
      { code: "GUT ALUM", description: "Gutters - aluminum K-style 5\"", unit: "LF", price: 12.50, category: "Roofing" },
      { code: "GUT DNSP", description: "Downspout - aluminum 2x3\"", unit: "LF", price: 8.75, category: "Roofing" },
      { code: "SDG VNL", description: "Siding - vinyl", unit: "SQ", price: 325.00, category: "Siding" },
      { code: "SDG HARDIE", description: "Siding - hardie board", unit: "SQ", price: 685.50, category: "Siding" },
      { code: "WDW DBL", description: "Window - double hung vinyl", unit: "EA", price: 425.00, category: "Windows" },
      { code: "DOOR EXT", description: "Door - exterior steel", unit: "EA", price: 850.00, category: "Doors" }
    ];

    try {
      await base44.entities.PriceListItem.bulkCreate(defaultItems);
      queryClient.invalidateQueries({ queryKey: ['price-list-items'] });
      alert("Loaded 20 default Xactimate items!");
    } catch (error) {
      console.error("Error loading default data:", error);
    }
  };

  const filteredItems = priceItems.filter(item => {
    const matchesSearch = 
      item.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const favorites = filteredItems.filter(item => item.is_favorite);
  const regularItems = filteredItems.filter(item => !item.is_favorite);
  const sortedItems = [...favorites, ...regularItems];

  const categories = ["all", "Roofing", "Siding", "Windows", "Doors", "Interior", "Exterior", "HVAC", "Plumbing", "Electrical", "Other"];

  return (
    <Card className="bg-white shadow-lg">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <CardTitle>Xactimate Price Browser</CardTitle>
          <Button onClick={loadDefaultData} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Load Default Items ({priceItems.length} loaded)
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search by code or description..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map(cat => (
                <SelectItem key={cat} value={cat}>
                  {cat === "all" ? "All Categories" : cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ScrollArea className="h-[500px]">
          <div className="space-y-2">
            {sortedItems.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <p className="mb-4">No price items loaded yet</p>
                <Button onClick={loadDefaultData} variant="outline">
                  <Upload className="w-4 h-4 mr-2" />
                  Load Default Xactimate Items
                </Button>
              </div>
            )}
            
            {sortedItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-sm font-mono font-semibold text-blue-600">
                      {item.code}
                    </code>
                    <Badge variant="outline" className="text-xs">
                      {item.category}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-700">{item.description}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-gray-500">Unit: {item.unit || "EA"}</span>
                    <span className="text-sm font-semibold text-green-600">
                      ${item.price?.toFixed(2)} / {item.unit || "EA"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
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
                  <Button
                    size="sm"
                    onClick={() => onAddItem && onAddItem(item)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="border-t pt-3 text-xs text-gray-500">
          <p>Showing {sortedItems.length} items {favorites.length > 0 && `(${favorites.length} favorites)`}</p>
        </div>
      </CardContent>
    </Card>
  );
}