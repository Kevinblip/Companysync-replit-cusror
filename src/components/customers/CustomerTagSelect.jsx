import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";

const PREDEFINED_TAGS = [
  "VIP",
  "High Priority",
  "Follow Up",
  "Insurance Claim",
  "Referral",
  "Repeat Customer",
  "Commercial",
  "Residential"
];

export default function CustomerTagSelect({ value = [], onChange, companyId }) {
  const [customTags, setCustomTags] = useState([]);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  useEffect(() => {
    if (companyId) {
      const saved = localStorage.getItem(`custom_customer_tags_${companyId}`);
      if (saved) {
        setCustomTags(JSON.parse(saved));
      }
    }
  }, [companyId]);

  const allTags = [...PREDEFINED_TAGS, ...customTags].sort();

  const handleAddCustomTag = () => {
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    
    if (allTags.some(t => t.toLowerCase() === trimmed.toLowerCase())) {
      alert("A tag with this name already exists.");
      return;
    }

    const updated = [...customTags, trimmed];
    setCustomTags(updated);
    
    if (companyId) {
      localStorage.setItem(`custom_customer_tags_${companyId}`, JSON.stringify(updated));
    }
    
    // Add to selected tags
    onChange([...value, trimmed]);
    setNewTagName("");
    setShowAddCustom(false);
  };

  const handleDeleteCustomTag = (tagName) => {
    if (!window.confirm(`Delete custom tag "${tagName}"?`)) {
      return;
    }
    
    const updated = customTags.filter(t => t !== tagName);
    setCustomTags(updated);
    
    if (companyId) {
      localStorage.setItem(`custom_customer_tags_${companyId}`, JSON.stringify(updated));
    }
    
    // Remove from selected if present
    if (value.includes(tagName)) {
      onChange(value.filter(t => t !== tagName));
    }
  };

  const handleSelectTag = (tag) => {
    if (tag === 'clear_all') {
      onChange([]);
    } else if (value.includes(tag)) {
      onChange(value.filter(t => t !== tag));
    } else {
      onChange([...value, tag]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-start">
        <Select value="" onValueChange={handleSelectTag}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder={value.length > 0 ? `${value.length} tag${value.length > 1 ? 's' : ''} selected` : "Select tags..."} />
          </SelectTrigger>
          <SelectContent>
            {value.length > 0 && (
              <>
                <SelectItem value="clear_all">Clear All</SelectItem>
                <SelectSeparator />
              </>
            )}
            <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase sticky top-0 bg-white">
              Standard Tags
            </div>
            {PREDEFINED_TAGS.map(tag => {
              const isSelected = value.includes(tag);
              return (
                <SelectItem key={tag} value={tag}>
                  <div className="flex items-center gap-2">
                    {isSelected && <span className="font-bold text-green-600">✓</span>}
                    {tag}
                  </div>
                </SelectItem>
              );
            })}
            {customTags.length > 0 && (
              <>
                <SelectSeparator />
                <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase sticky top-0 bg-white">
                  Custom Tags
                </div>
                {customTags.map(tag => {
                  const isSelected = value.includes(tag);
                  return (
                    <SelectItem key={tag} value={tag}>
                      <div className="flex items-center gap-2">
                        {isSelected && <span className="font-bold text-green-600">✓</span>}
                        {tag}
                      </div>
                    </SelectItem>
                  );
                })}
              </>
            )}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setShowAddCustom(!showAddCustom)}
          title="Add custom tag"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((tag, idx) => (
            <Badge
              key={idx}
              variant="secondary"
              className="cursor-pointer hover:bg-red-100"
              onClick={() => onChange(value.filter(t => t !== tag))}
            >
              {tag} ×
            </Badge>
          ))}
        </div>
      )}

      {showAddCustom && (
        <div className="p-3 border rounded-lg bg-gray-50 space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="New tag name"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCustomTag();
                }
              }}
              autoFocus
            />
            <Button onClick={handleAddCustomTag} size="sm" disabled={!newTagName.trim()}>
              Add
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => {
                setShowAddCustom(false);
                setNewTagName("");
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {customTags.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-600">Manage Custom Tags:</p>
              {customTags.map(tag => (
                <div key={tag} className="flex items-center justify-between p-2 bg-white rounded border text-sm">
                  <span>{tag}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteCustomTag(tag)}
                    className="h-6 w-6 p-0 text-red-600 hover:bg-red-50"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}