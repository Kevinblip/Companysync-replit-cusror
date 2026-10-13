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
import { normalizeAssignmentStaff } from "@/utils/customerStaffAssignment";

export default function StaffMultiSelect({ 
  staffProfiles = [], 
  selectedEmails = [], 
  onChange,
  isLoading = false,
  error = null,
  onRetry,
  onOpen,
}) {
  const [open, setOpen] = React.useState(false);
  const assignableStaff = React.useMemo(() => normalizeAssignmentStaff(staffProfiles), [staffProfiles]);
  const getStaffEmail = (staff) => staff.user_email || staff.email || "";

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
      <Popover open={open} onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) onOpen?.();
      }}>
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
                type="button"
                onClick={handleClearAll}
                className="h-7 text-xs"
              >
                Clear All
              </Button>
            )}
          </div>
          <ScrollArea className="h-64">
            <div className="p-2">
              {assignableStaff
                .map(staff => {
                  const email = getStaffEmail(staff);
                  const isSelected = selectedEmails.includes(email);
                  return (
                    <div
                      key={email}
                      className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer"
                      onClick={() => handleToggleStaff(email)}
                    >
                      <Checkbox
                        aria-label={`Assign ${staff.full_name || email}`}
                        checked={isSelected}
                        onClick={event => event.stopPropagation()}
                        onCheckedChange={() => handleToggleStaff(email)}
                      />
                      <div className="flex-1">
                        <div className="font-medium text-sm">
                          {staff.full_name || staff.user_email}
                        </div>
                        <div className="text-xs text-gray-500">{email}</div>
                      </div>
                    </div>
                  );
                })}
              {error ? (
                <div role="alert" className="text-center py-4 text-red-600 text-sm">
                  Could not load staff. Please try again.
                  {onRetry && <Button type="button" variant="outline" size="sm" className="mt-2 block mx-auto" onClick={() => onRetry()}>Retry</Button>}
                </div>
              ) : isLoading ? (
                <div role="status" className="text-center py-4 text-gray-500 text-sm">Loading staff members…</div>
              ) : assignableStaff.length === 0 && (
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
            const staff = assignableStaff.find(s => getStaffEmail(s) === email);
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