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
  SelectSeparator,
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

export default function InstallerSelect({ value, onChange, companyId }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newInstallerName, setNewInstallerName] = useState("");
  const [newInstallerPhone, setNewInstallerPhone] = useState("");
  
  const queryClient = useQueryClient();

  const { data: installers = [], isLoading } = useQuery({
    queryKey: ['subcontractors-select', companyId],
    queryFn: () => companyId ? base44.entities.Subcontractor.filter({ company_id: companyId, is_active: true }, "name", 1000) : [],
    enabled: !!companyId,
    initialData: []
  });

  const createInstallerMutation = useMutation({
    mutationFn: async (data) => {
      return base44.entities.Subcontractor.create({
        ...data,
        company_id: companyId,
        is_active: true
      });
    },
    onSuccess: (newInstaller) => {
      queryClient.invalidateQueries({ queryKey: ['subcontractors-select'] });
      onChange(newInstaller.name);
      setShowAddDialog(false);
      setNewInstallerName("");
      setNewInstallerPhone("");
      toast.success("Installer created!");
    },
    onError: (error) => {
      toast.error("Failed to create installer: " + error.message);
    }
  });

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newInstallerName.trim()) return;
    
    createInstallerMutation.mutate({
      name: newInstallerName.trim(),
      phone: newInstallerPhone.trim()
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-start">
        <Select value={value || ""} onValueChange={onChange}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select installer..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none_selection_special_value">None</SelectItem>
            {installers.map((installer) => (
              <SelectItem key={installer.id} value={installer.name}>
                {installer.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setShowAddDialog(true)}
          title="Add new installer"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Installer</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <Label>Installer Name *</Label>
              <Input
                value={newInstallerName}
                onChange={(e) => setNewInstallerName(e.target.value)}
                placeholder="e.g. John Smith Roofing"
                required
              />
            </div>
            <div>
              <Label>Phone (Optional)</Label>
              <Input
                value={newInstallerPhone}
                onChange={(e) => setNewInstallerPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
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