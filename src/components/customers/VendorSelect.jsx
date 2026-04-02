import React, { useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function VendorSelect({ value, onChange, companyId }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  
  const queryClient = useQueryClient();

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ['vendors-select', companyId],
    queryFn: () => companyId ? base44.entities.Vendor.filter({ company_id: companyId, is_active: true }, "vendor_name", 1000) : [],
    enabled: !!companyId,
    initialData: []
  });

  const createVendorMutation = useMutation({
    mutationFn: async (data) => {
      return base44.entities.Vendor.create({
        ...data,
        company_id: companyId,
        is_active: true,
        vendor_type: 'supplier'
      });
    },
    onSuccess: (newVendor) => {
      queryClient.invalidateQueries({ queryKey: ['vendors-select'] });
      onChange(newVendor.vendor_name);
      setShowAddDialog(false);
      setNewVendorName("");
      toast.success("Vendor created!");
    },
    onError: (error) => {
      toast.error("Failed to create vendor: " + error.message);
    }
  });

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newVendorName.trim()) return;
    
    createVendorMutation.mutate({
      vendor_name: newVendorName.trim()
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-start">
        <Select value={value || ""} onValueChange={onChange}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select vendor..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none_selection_special_value">None</SelectItem>
            {vendors.map((vendor) => (
              <SelectItem key={vendor.id} value={vendor.vendor_name}>
                {vendor.vendor_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setShowAddDialog(true)}
          title="Add new vendor"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Vendor</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <Label>Vendor Name *</Label>
              <Input
                value={newVendorName}
                onChange={(e) => setNewVendorName(e.target.value)}
                placeholder="e.g. ABC Supply"
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createVendorMutation.isPending || !newVendorName.trim()}>
                {createVendorMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}