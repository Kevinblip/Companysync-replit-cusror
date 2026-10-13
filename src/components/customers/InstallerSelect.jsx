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

export default function InstallerSelect({ value, values, onChange, companyId }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newInstallerName, setNewInstallerName] = useState("");
  const [newInstallerPhone, setNewInstallerPhone] = useState("");
  const queryClient = useQueryClient();

  const selected = values
    ? values
    : value
      ? (Array.isArray(value) ? value : value ? [value] : [])
      : [];

  const { data: installers = [] } = useQuery({
    queryKey: ['subcontractors-select', companyId],
    queryFn: () => companyId ? base44.entities.Subcontractor.filter({ company_id: companyId, is_active: true }, "name", 1000) : [],
    enabled: !!companyId,
  });

  const createInstallerMutation = useMutation({
    mutationFn: async (data) => base44.entities.Subcontractor.create({ ...data, company_id: companyId, is_active: true }),
    onSuccess: (newInstaller) => {
      queryClient.invalidateQueries({ queryKey: ['subcontractors-select'] });
      handleAdd(newInstaller.name);
      setShowAddDialog(false);
      setNewInstallerName("");
      setNewInstallerPhone("");
      toast.success("Installer created!");
    },
    onError: (error) => toast.error("Failed to create installer: " + error.message),
  });

  function handleAdd(name) {
    if (!name || name === 'none_selection_special_value') return;
    if (selected.includes(name)) return;
    onChange([...selected, name]);
  }

  function handleRemove(name) {
    onChange(selected.filter(n => n !== name));
  }

  const available = installers.filter(i => !selected.includes(i.name));

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map(name => (
            <span key={name} className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-sm px-2 py-1 rounded-full">
              {name}
              <button type="button" onClick={() => handleRemove(name)} className="hover:text-blue-900">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-center">
        <Select value="" onValueChange={handleAdd}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder={selected.length === 0 ? "Select installer..." : "Add another installer..."} />
          </SelectTrigger>
          <SelectContent>
            {available.length === 0
              ? <SelectItem value="__none__" disabled>All installers selected</SelectItem>
              : available.map(i => (
                  <SelectItem key={i.id} value={i.name}>{i.name}</SelectItem>
                ))
            }
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="icon" onClick={() => setShowAddDialog(true)} title="Create new installer">
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Installer</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (!newInstallerName.trim()) return; createInstallerMutation.mutate({ name: newInstallerName.trim(), phone: newInstallerPhone.trim() }); }} className="space-y-4">
            <div>
              <Label>Installer Name *</Label>
              <Input value={newInstallerName} onChange={(e) => setNewInstallerName(e.target.value)} placeholder="e.g. John Smith Roofing" required />
            </div>
            <div>
              <Label>Phone (Optional)</Label>
              <Input value={newInstallerPhone} onChange={(e) => setNewInstallerPhone(e.target.value)} placeholder="(555) 123-4567" />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={createInstallerMutation.isPending || !newInstallerName.trim()}>
                {createInstallerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
