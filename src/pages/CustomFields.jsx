import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import useTranslation from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Edit,
  Trash2,
  GripVertical,
  Database,
  CheckCircle
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function CustomFields() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editingField, setEditingField] = useState(null);
  const [selectedEntity, setSelectedEntity] = useState("Lead");
  const [formData, setFormData] = useState({
    entity_name: "Lead",
    field_name: "",
    field_label: "",
    field_type: "text",
    field_options: [],
    is_required: false,
    default_value: "",
    is_active: true,
    order: 0,
    help_text: ""
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const myCompany = companies.find(c => c.created_by === user?.email);

  const { data: customFields = [] } = useQuery({
    queryKey: ['custom-fields', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CustomField.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.CustomField.create({ ...data, company_id: myCompany.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-fields'] });
      handleCloseDialog();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.CustomField.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-fields'] });
      handleCloseDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.CustomField.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-fields'] });
    },
  });

  const handleEdit = (field) => {
    setEditingField(field);
    setFormData({
      entity_name: field.entity_name,
      field_name: field.field_name,
      field_label: field.field_label,
      field_type: field.field_type,
      field_options: field.field_options || [],
      is_required: field.is_required,
      default_value: field.default_value || "",
      is_active: field.is_active,
      order: field.order || 0,
      help_text: field.help_text || ""
    });
    setShowDialog(true);
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditingField(null);
    setFormData({
      entity_name: selectedEntity,
      field_name: "",
      field_label: "",
      field_type: "text",
      field_options: [],
      is_required: false,
      default_value: "",
      is_active: true,
      order: 0,
      help_text: ""
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingField) {
      updateMutation.mutate({ id: editingField.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id) => {
    if (window.confirm(t.leads.deleteConfirm)) {
      deleteMutation.mutate(id);
    }
  };

  const entities = ["Lead", "Customer", "Project", "Task", "Invoice", "Estimate", "Proposal", "Contract"];
  
  const fieldTypes = [
    { value: "text", label: "Text" },
    { value: "number", label: "Number" },
    { value: "date", label: t.common.date },
    { value: "boolean", label: "Yes/No" },
    { value: "select", label: "Dropdown (Single)" },
    { value: "multiselect", label: "Dropdown (Multiple)" },
    { value: "textarea", label: "Text Area" },
    { value: "email", label: t.common.email },
    { value: "phone", label: t.common.phone },
    { value: "url", label: "URL" },
  ];

  const filteredFields = customFields.filter(f => f.entity_name === selectedEntity).sort((a, b) => (a.order || 0) - (b.order || 0));

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.sidebar.customFields}</h1>
          <p className="text-gray-500 mt-1">Add custom fields to your CRM entities</p>
        </div>

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => { setEditingField(null); setShowDialog(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              {t.common.add} {t.sidebar.customFields}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingField ? `${t.common.edit} ${t.sidebar.customFields}` : `${t.common.add} ${t.sidebar.customFields}`}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Apply To *</Label>
                  <Select value={formData.entity_name} onValueChange={(v) => setFormData({...formData, entity_name: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {entities.map(entity => (
                        <SelectItem key={entity} value={entity}>{entity}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Field Type *</Label>
                  <Select value={formData.field_type} onValueChange={(v) => setFormData({...formData, field_type: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fieldTypes.map(type => (
                        <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>{t.common.name} * (no spaces)</Label>
                  <Input
                    value={formData.field_name}
                    onChange={(e) => setFormData({...formData, field_name: e.target.value.toLowerCase().replace(/\s+/g, '_')})}
                    placeholder="e.g., roofing_type"
                    required
                  />
                </div>

                <div>
                  <Label>Display Label *</Label>
                  <Input
                    value={formData.field_label}
                    onChange={(e) => setFormData({...formData, field_label: e.target.value})}
                    placeholder="e.g., Roofing Type"
                    required
                  />
                </div>
              </div>

              {(formData.field_type === 'select' || formData.field_type === 'multiselect') && (
                <div>
                  <Label>Options (comma-separated) *</Label>
                  <Input
                    value={formData.field_options.join(', ')}
                    onChange={(e) => setFormData({...formData, field_options: e.target.value.split(',').map(s => s.trim())})}
                    placeholder="e.g., Shingles, Metal, Tile, Flat"
                  />
                </div>
              )}

              <div>
                <Label>Help Text</Label>
                <Textarea
                  value={formData.help_text}
                  onChange={(e) => setFormData({...formData, help_text: e.target.value})}
                  placeholder="Optional help text shown to users"
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Default Value</Label>
                  <Input
                    value={formData.default_value}
                    onChange={(e) => setFormData({...formData, default_value: e.target.value})}
                    placeholder="Optional default value"
                  />
                </div>

                <div>
                  <Label>Display Order</Label>
                  <Input
                    type="number"
                    value={formData.order}
                    onChange={(e) => setFormData({...formData, order: parseInt(e.target.value)})}
                  />
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={formData.is_required}
                    onCheckedChange={(checked) => setFormData({...formData, is_required: checked})}
                  />
                  <Label>{t.common.required}</Label>
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({...formData, is_active: checked})}
                  />
                  <Label>{t.common.active}</Label>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                  {t.common.cancel}
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                  {editingField ? t.common.update : t.common.create}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Alert className="bg-blue-50 border-blue-200">
        <Database className="w-4 h-4" />
        <AlertDescription>
          <strong>Pro Tip:</strong> Custom fields allow you to capture additional data specific to your business. 
          After creating fields, they'll automatically appear when adding/editing records.
        </AlertDescription>
      </Alert>

      {/* Entity Tabs */}
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center gap-2 flex-wrap">
            {entities.map(entity => (
              <Button
                key={entity}
                variant={selectedEntity === entity ? "default" : "outline"}
                onClick={() => setSelectedEntity(entity)}
                size="sm"
              >
                {entity}
                <Badge variant="secondary" className="ml-2">
                  {customFields.filter(f => f.entity_name === entity).length}
                </Badge>
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {filteredFields.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Database className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-semibold mb-2">{t.common.noResults} {t.sidebar.customFields} for {selectedEntity}</h3>
              <p className="text-sm mb-4">Add your first custom field to capture additional data</p>
              <Button onClick={() => setShowDialog(true)}>
                <Plus className="w-4 h-4 mr-2" />
                {t.common.add}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredFields.map((field) => (
                <Card key={field.id} className="bg-gray-50 hover:bg-gray-100 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 flex-1">
                        <GripVertical className="w-5 h-5 text-gray-400 cursor-move" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-gray-900">{field.field_label}</h3>
                            <Badge variant="outline" className="text-xs">
                              {field.field_type}
                            </Badge>
                            {field.is_required && (
                              <Badge className="bg-red-100 text-red-700 text-xs">{t.common.required}</Badge>
                            )}
                            {!field.is_active && (
                              <Badge className="bg-gray-100 text-gray-700 text-xs">{t.common.inactive}</Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mt-1">
                            {t.common.name}: <code className="bg-white px-2 py-1 rounded">{field.field_name}</code>
                          </p>
                          {field.help_text && (
                            <p className="text-xs text-gray-500 mt-1">{field.help_text}</p>
                          )}
                          {field.field_options && field.field_options.length > 0 && (
                            <p className="text-xs text-gray-500 mt-1">
                              Options: {field.field_options.join(', ')}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="icon" variant="ghost" onClick={() => handleEdit(field)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => handleDelete(field.id)}>
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}