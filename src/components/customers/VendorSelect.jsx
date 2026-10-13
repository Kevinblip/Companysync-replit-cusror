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
import { Plus, X, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function VendorSelect({ value, values, onChange, companyId }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  const queryClient = useQueryClient();

  const selected = values
    ? values
    : value
      ? (Array.isArray(value) ? value : value ? [value] : [])
      : [];

  const { data: vendors = [] } = useQuery({
    queryKey: ['vendors-select', companyId],
    queryFn: () => companyId ? base44.entities.Vendor.filter({ company_id: companyId, is_active: true }, "vendor_name", 1000) : [],
    enabled: !!companyId,
  });

  const createVendorMutation = useMutation({
    mutationFn: async (data) => base44.entities.Vendor.create({ ...data, company_id: companyId, is_active: true, vendor_type: 'supplier' }),
    onSuccess: (newVendor) => {
      queryClient.invalidateQueries({ queryKey: ['vendors-select'] });
      handleAdd(newVendor.vendor_name);
      setShowAddDialog(false);
      setNewVendorName("");
      toast.success("Vendor created!");
    },
    onError: (error) => toast.error("Failed to create vendor: " + error.message),
  });

  function handleAdd(name) {
    if (!name || name === 'none_selection_special_value') return;
    if (selected.includes(name)) return;
    onChange([...selected, name]);
  }

  function handleRemove(name) {
    onChange(selected.filter(n => n !== name));
  }

  const available = vendors.filter(v => !selected.includes(v.vendor_name));

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map(name => (
            <span key={name} className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-sm px-2 py-1 rounded-full">
              {name}
              <button type="button" onClick={() => handleRemove(name)} className="hover:text-green-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-center">
        <Select value="" onValueChange={handleAdd}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder={selected.length === 0 ? "Select vendor..." : "Add another vendor..."} />
          </SelectTrigger>
          <SelectContent>
            {available.length === 0
              ? <SelectItem value="__none__" disabled>All vendors selected</SelectItem>
              : available.map(v => (
                  <SelectItem key={v.id} value={v.vendor_name}>{v.vendor_name}</SelectItem>
                ))
            }
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="icon" onClick={() => setShowAddDialog(true)} title="Create new vendor">
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Vendor</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (!newVendorName.trim()) return; createVendorMutation.mutate({ vendor_name: newVendorName.trim() }); }} className="space-y-4">
            <div>
              <Label>Vendor Name *</Label>
              <Input value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} placeholder="e.g. ABC Supply" required />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
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
