import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, X, ChevronDown } from "lucide-react";

const PREDEFINED_GROUPS = [
  "Retail Sales",
  "Insurance Claims",
  "Water Mitigation",
  "Fire Mitigation",
  "Gutters",
  "Siding",
  "Windows & Doors",
  "Roofing",
  "Remodeling",
  "VIP",
  "Commercial",
  "Residential"
];

export default function CustomerGroupSelect({ value, onChange, companyId }) {
  const [customGroups, setCustomGroups] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const dropdownRef = useRef(null);

  const selectedGroups = Array.isArray(value) ? value : (value ? [value] : []);

  useEffect(() => {
    if (companyId) {
      const saved = localStorage.getItem(`custom_customer_groups_${companyId}`);
      if (saved) setCustomGroups(JSON.parse(saved));
    }
  }, [companyId]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
        setShowAddCustom(false);
        setNewGroupName("");
      }
    };
    if (showDropdown) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showDropdown]);

  const allGroups = [...PREDEFINED_GROUPS, ...customGroups].sort();
  const availableGroups = allGroups.filter(g => !selectedGroups.includes(g));

  const addGroup = (group) => {
    if (!selectedGroups.includes(group)) {
      onChange([...selectedGroups, group]);
    }
  };

  const removeGroup = (group) => {
    onChange(selectedGroups.filter(g => g !== group));
  };

  const handleAddCustomGroup = () => {
    const trimmed = newGroupName.trim();
    if (!trimmed) return;
    if (allGroups.some(g => g.toLowerCase() === trimmed.toLowerCase())) {
      alert("A group with this name already exists.");
      return;
    }
    const updated = [...customGroups, trimmed];
    setCustomGroups(updated);
    if (companyId) {
      localStorage.setItem(`custom_customer_groups_${companyId}`, JSON.stringify(updated));
    }
    addGroup(trimmed);
    setNewGroupName("");
    setShowAddCustom(false);
  };

  const handleDeleteCustomGroup = (groupName) => {
    if (!window.confirm(`Delete custom group "${groupName}"?`)) return;
    const updated = customGroups.filter(g => g !== groupName);
    setCustomGroups(updated);
    if (companyId) {
      localStorage.setItem(`custom_customer_groups_${companyId}`, JSON.stringify(updated));
    }
    if (selectedGroups.includes(groupName)) {
      onChange(selectedGroups.filter(g => g !== groupName));
    }
  };

  return (
    <div className="space-y-2">
      {selectedGroups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedGroups.map(group => (
            <Badge
              key={group}
              variant="secondary"
              className="flex items-center gap-1 pr-1 text-sm"
            >
              {group}
              <button
                type="button"
                onClick={() => removeGroup(group)}
                className="ml-0.5 rounded-full hover:bg-gray-300 p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-start relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => { setShowDropdown(!showDropdown); setShowAddCustom(false); }}
          className="flex-1 flex items-center justify-between px-3 py-2 border rounded-md text-sm bg-white hover:bg-gray-50 text-left"
        >
          <span className="text-gray-500">
            {selectedGroups.length === 0 ? "Select group..." : "Add another group..."}
          </span>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => { setShowAddCustom(!showAddCustom); setShowDropdown(false); }}
          title="Add custom group"
        >
          <Plus className="w-4 h-4" />
        </Button>

        {showDropdown && (
          <div className="absolute top-full left-0 z-50 mt-1 w-full bg-white border rounded-md shadow-lg max-h-60 overflow-auto">
            {availableGroups.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500">All groups selected</div>
            ) : (
              <>
                <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase bg-gray-50 sticky top-0">
                  Standard Groups
                </div>
                {PREDEFINED_GROUPS.filter(g => !selectedGroups.includes(g)).map(group => (
                  <button
                    key={group}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                    onClick={() => { addGroup(group); setShowDropdown(false); }}
                  >
                    {group}
                  </button>
                ))}
                {customGroups.filter(g => !selectedGroups.includes(g)).length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase bg-gray-50 sticky top-0 border-t">
                      Custom Groups
                    </div>
                    {customGroups.filter(g => !selectedGroups.includes(g)).map(group => (
                      <div key={group} className="flex items-center justify-between hover:bg-gray-100 px-1">
                        <button
                          type="button"
                          className="flex-1 text-left px-2 py-2 text-sm"
                          onClick={() => { addGroup(group); setShowDropdown(false); }}
                        >
                          {group}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDeleteCustomGroup(group); }}
                          className="p-1 text-red-500 hover:text-red-700"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {showAddCustom && (
        <div className="p-3 border rounded-lg bg-gray-50 space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="New group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleAddCustomGroup(); }
                if (e.key === 'Escape') { setShowAddCustom(false); setNewGroupName(""); }
              }}
              autoFocus
            />
            <Button onClick={handleAddCustomGroup} size="sm" disabled={!newGroupName.trim()}>
              Add
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { setShowAddCustom(false); setNewGroupName(""); }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
