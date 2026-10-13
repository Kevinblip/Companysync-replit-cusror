import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

export default function TagInput({ values = [], onChange, placeholder = "Type and press Enter...", chipColor = "purple" }) {
  const [inputVal, setInputVal] = useState("");

  const colorMap = {
    purple: "bg-purple-100 text-purple-800 hover:text-purple-900",
    orange: "bg-orange-100 text-orange-800 hover:text-orange-900",
    blue:   "bg-blue-100 text-blue-800 hover:text-blue-900",
    green:  "bg-green-100 text-green-800 hover:text-green-900",
  };
  const chipClass = colorMap[chipColor] || colorMap.purple;

  function addTag() {
    const val = inputVal.trim();
    if (!val || values.includes(val)) return;
    onChange([...values, val]);
    setInputVal("");
  }

  function removeTag(tag) {
    onChange(values.filter(v => v !== tag));
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  }

  return (
    <div className="space-y-2">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map(tag => (
            <span key={tag} className={`inline-flex items-center gap-1 text-sm px-2 py-1 rounded-full ${chipClass}`}>
              {tag}
              <button type="button" onClick={() => removeTag(tag)}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-center">
        <Input
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={values.length === 0 ? placeholder : `Add another...`}
          className="flex-1"
        />
        <Button type="button" variant="outline" size="icon" onClick={addTag} disabled={!inputVal.trim()}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
