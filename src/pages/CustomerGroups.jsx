import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Edit, Trash2, Users } from "lucide-react";

const PRESET_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", 
  "#ec4899", "#06b6d4", "#14b8a6", "#f97316", "#6366f1"
];

export default function CustomerGroups() {
  const { user } = useAuth();
  const [showDialog, setShowDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);
  const [formData, setFormData] = useState({
    group_name: "",
    description: "",
    color: "#3b82f6"
  });

  const queryClient = useQueryClient();

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const myCompany = companies.find(c => c.created_by === user?.email);

  const { data: groups = [] } = useQuery({
    queryKey: ['customer-groups', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CustomerGroup.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const createGroupMutation = useMutation({
    mutationFn: (data) => base44.entities.CustomerGroup.create({ ...data, company_id: myCompany.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-groups'] });
      setShowDialog(false);
      setEditingGroup(null);
      setFormData({ group_name: "", description: "", color: "#3b82f6" });
    },
  });

  const updateGroupMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.CustomerGroup.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-groups'] });
      setShowDialog(false);
      setEditingGroup(null);
      setFormData({ group_name: "", description: "", color: "#3b82f6" });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id) => base44.entities.CustomerGroup.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-groups'] });
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingGroup) {
      updateGroupMutation.mutate({ id: editingGroup.id, data: formData });
    } else {
      createGroupMutation.mutate(formData);
    }
  };

  const handleEdit = (group) => {
    setEditingGroup(group);
    setFormData({
      group_name: group.group_name,
      description: group.description || "",
      color: group.color || "#3b82f6"
    });
    setShowDialog(true);
  };

  const handleDelete = (id) => {
    if (window.confirm("Are you sure you want to delete this group? Customers in this group will not be deleted.")) {
      deleteGroupMutation.mutate(id);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Users className="w-8 h-8 text-purple-600" />
            Customer Groups
          </h1>
          <p className="text-gray-500 mt-1">Organize customers into groups for better management</p>
        </div>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button className="bg-purple-600 hover:bg-purple-700">
              <Plus className="w-4 h-4 mr-2" />
              New Group
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingGroup ? 'Edit Customer Group' : 'Create Customer Group'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>Group Name *</Label>
                <Input
                  value={formData.group_name}
                  onChange={(e) => setFormData({...formData, group_name: e.target.value})}
                  placeholder="e.g., Insurance Claims, Sub Contractors, VIP Customers"
                  required
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  placeholder="Brief description of this group..."
                  rows={3}
                />
              </div>
              <div>
                <Label>Group Color</Label>
                <div className="flex gap-2 mt-2">
                  {PRESET_COLORS.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setFormData({...formData, color})}
                      className={`w-8 h-8 rounded-full border-2 ${formData.color === color ? 'border-gray-900 scale-110' : 'border-gray-300'} transition-all`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-purple-600 hover:bg-purple-700">
                  {editingGroup ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Customer Groups</CardTitle>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-600 mb-2">No Customer Groups</h3>
              <p className="text-gray-500 mb-4">Create groups to organize your customers</p>
              <Button onClick={() => setShowDialog(true)} className="bg-purple-600 hover:bg-purple-700">
                <Plus className="w-4 h-4 mr-2" />
                Create Group
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {groups.map(group => (
                <div key={group.id} className="p-4 border rounded-lg hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                        style={{ backgroundColor: group.color }}
                      >
                        {group.group_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-900">{group.group_name}</div>
                        {group.description && (
                          <div className="text-sm text-gray-600 mt-1">{group.description}</div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 mt-4">
                    <Button variant="outline" size="sm" onClick={() => handleEdit(group)}>
                      <Edit className="w-4 h-4 mr-2" />
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => handleDelete(group.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}