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

export default function MaterialBrandSelect({ values = [], onChange, companyId }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");
  const queryClient = useQueryClient();

  const { data: brands = [] } = useQuery({
    queryKey: ['material-brands', companyId],
    queryFn: () => companyId ? base44.entities.MaterialBrand.filter({ company_id: companyId }, "name", 1000) : [],
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.MaterialBrand.create({ ...data, company_id: companyId }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['material-brands'] });
      handleAdd(created.name);
      setShowAddDialog(false);
      setNewBrandName("");
      toast.success("Brand saved!");
    },
    onError: (err) => toast.error("Failed to save brand: " + err.message),
  });

  function handleAdd(name) {
    if (!name || values.includes(name)) return;
    onChange([...values, name]);
  }

  function handleRemove(name) {
    onChange(values.filter(v => v !== name));
  }

  const available = brands.filter(b => !values.includes(b.name));

  return (
    <div className="space-y-2">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map(name => (
            <span key={name} className="inline-flex items-center gap-1 bg-purple-100 text-purple-800 text-sm px-2 py-1 rounded-full">
              {name}
              <button type="button" onClick={() => handleRemove(name)} className="hover:text-purple-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-center">
        <Select value="" onValueChange={handleAdd}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder={values.length === 0 ? "Select brand..." : "Add another brand..."} />
          </SelectTrigger>
          <SelectContent>
            {available.length === 0
              ? <SelectItem value="__none__" disabled>No more brands</SelectItem>
              : available.map(b => (
                  <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>
                ))
            }
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="icon" onClick={() => setShowAddDialog(true)} title="Add new brand">
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Material Brand</DialogTitle></DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (!newBrandName.trim()) return; createMutation.mutate({ name: newBrandName.trim() }); }} className="space-y-4">
            <div>
              <Label>Brand Name *</Label>
              <Input value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)} placeholder="e.g. Owens Corning, GAF, CertainTeed" required />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending || !newBrandName.trim()}>
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
