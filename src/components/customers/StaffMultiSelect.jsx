import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Users, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function StaffMultiSelect({ 
  staffProfiles = [], 
  selectedEmails = [], 
  onChange 
}) {
  const [open, setOpen] = React.useState(false);

  const handleToggleStaff = (email) => {
    const isSelected = selectedEmails.includes(email);
    if (isSelected) {
      onChange(selectedEmails.filter(e => e !== email));
    } else {
      onChange([...selectedEmails, email]);
    }
  };

  const handleRemoveStaff = (email) => {
    onChange(selectedEmails.filter(e => e !== email));
  };

  const handleClearAll = () => {
    onChange([]);
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-start h-12 text-base"
            type="button"
          >
            <Users className="w-4 h-4 mr-2" />
            {selectedEmails.length === 0 
              ? "Select staff members" 
              : `${selectedEmails.length} staff selected`}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <div className="p-3 border-b flex items-center justify-between">
            <span className="font-semibold text-sm">Assign Staff</span>
            {selectedEmails.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                className="h-7 text-xs"
              >
                Clear All
              </Button>
            )}
          </div>
          <ScrollArea className="h-64">
            <div className="p-2">
              {staffProfiles
                .filter(staff => staff.user_email && staff.user_email.trim() !== "")
                .map(staff => {
                  const isSelected = selectedEmails.includes(staff.user_email);
                  return (
                    <div
                      key={staff.user_email}
                      className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                      onClick={() => handleToggleStaff(staff.user_email)}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleToggleStaff(staff.user_email)}
                      />
                      <div className="flex-1">
                        <div className="font-medium text-sm">
                          {staff.full_name || staff.user_email}
                        </div>
                        <div className="text-xs text-gray-500">{staff.user_email}</div>
                      </div>
                    </div>
                  );
                })}
              {staffProfiles.filter(staff => staff.user_email && staff.user_email.trim() !== "").length === 0 && (
                <div className="text-center py-4 text-gray-500 text-sm">
                  No staff members available
                </div>
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>

      {selectedEmails.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedEmails.map(email => {
            const staff = staffProfiles.find(s => s.user_email === email);
            return (
              <Badge key={email} variant="secondary" className="flex items-center gap-1 pl-2 pr-1">
                <span className="text-xs">{staff?.full_name || email}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveStaff(email)}
                  className="ml-1 hover:bg-gray-300 rounded-full p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}