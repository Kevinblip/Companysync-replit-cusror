import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mail, Plus, Edit, Trash2, Copy } from "lucide-react";
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import useTranslation from "@/hooks/useTranslation";

export default function EmailTemplates() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState("all");
  
  const [formData, setFormData] = useState({
    template_name: "",
    subject: "",
    body: "",
    category: "general",
    merge_fields: []
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  const { data: allTemplates = [] } = useQuery({
    queryKey: ['email-templates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.EmailTemplate.filter({ company_id: myCompany.id }, "-created_date", 1000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const templates = allTemplates.filter(t => t.company_id === myCompany?.id || t.company_id === '695944e3c1fb00b7ab716c6f' || t.is_default);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.EmailTemplate.create({ ...data, company_id: myCompany.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      handleCloseDialog();
      alert('Template created successfully!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.EmailTemplate.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      handleCloseDialog();
      alert('Template updated successfully!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.EmailTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      alert('Template deleted!');
    },
  });

  const handleCloseDialog = () => {
    setShowDialog(false);
    setEditingTemplate(null);
    setFormData({
      template_name: "",
      subject: "",
      body: "",
      category: "general",
      merge_fields: []
    });
  };

  const handleEdit = (template) => {
    setEditingTemplate(template);
    setFormData({
      template_name: template.template_name || "",
      subject: template.subject || "",
      body: template.body || "",
      category: template.category || "general",
      merge_fields: template.merge_fields || []
    });
    setShowDialog(true);
  };

  const handleDuplicate = (template) => {
    setFormData({
      template_name: template.template_name + " (Copy)",
      subject: template.subject,
      body: template.body,
      category: template.category,
      merge_fields: template.merge_fields || []
    });
    setShowDialog(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.template_name || !formData.subject || !formData.body) {
      alert('Please fill in all required fields');
      return;
    }

    if (editingTemplate) {
      await updateMutation.mutateAsync({ id: editingTemplate.id, data: formData });
    } else {
      await createMutation.mutateAsync(formData);
    }
  };

  const handleDelete = (id, isDefault) => {
    if (isDefault) {
      alert('Cannot delete default system templates');
      return;
    }
    if (window.confirm('Are you sure you want to delete this template?')) {
      deleteMutation.mutate(id);
    }
  };

  const filteredTemplates = selectedCategory === "all"
    ? templates
    : templates.filter(t => t.category === selectedCategory);

  const categories = {
    estimates: { name: "Estimates", color: "bg-blue-100 text-blue-700" },
    invoices: { name: "Invoices", color: "bg-green-100 text-green-700" },
    proposals: { name: "Proposals", color: "bg-purple-100 text-purple-700" },
    contracts: { name: "Contracts", color: "bg-orange-100 text-orange-700" },
    payments: { name: "Payments", color: "bg-emerald-100 text-emerald-700" },
    projects: { name: "Projects", color: "bg-indigo-100 text-indigo-700" },
    tasks: { name: "Tasks", color: "bg-pink-100 text-pink-700" },
    customers: { name: "Customers", color: "bg-cyan-100 text-cyan-700" },
    leads: { name: "Leads", color: "bg-yellow-100 text-yellow-700" },
    staff: { name: "Staff Members", color: "bg-red-100 text-red-700" },
    tickets: { name: "Tickets", color: "bg-violet-100 text-violet-700" },
    subscriptions: { name: "Subscriptions", color: "bg-teal-100 text-teal-700" },
    general: { name: "General", color: "bg-gray-100 text-gray-700" }
  };

  const groupedTemplates = {};
  filteredTemplates.forEach(template => {
    if (!groupedTemplates[template.category]) {
      groupedTemplates[template.category] = [];
    }
    groupedTemplates[template.category].push(template);
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900" data-testid="text-page-title">{t.sidebar.emailTemplates}</h1>
          <p className="text-gray-500 mt-1" data-testid="text-page-description">Manage your email communication templates</p>
        </div>

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700" data-testid="button-create-template">
              <Plus className="w-4 h-4 mr-2" />
              {t.common.create} {t.settings.templates}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingTemplate ? `${t.common.edit} ${t.settings.templates}` : `${t.common.create} ${t.common.new} ${t.settings.templates}`}
              </DialogTitle>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t.common.name} *</Label>
                  <Input
                    value={formData.template_name}
                    onChange={(e) => setFormData({...formData, template_name: e.target.value})}
                    placeholder="e.g., Send Estimate to Customer"
                    data-testid="input-template-name"
                  />
                </div>

                <div>
                  <Label>{t.accounting.category} *</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) => setFormData({...formData, category: value})}
                  >
                    <SelectTrigger data-testid="select-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(categories).map(([key, cat]) => (
                        <SelectItem key={key} value={key}>{cat.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label>{t.communication.subject} *</Label>
                <Input
                  value={formData.subject}
                  onChange={(e) => setFormData({...formData, subject: e.target.value})}
                  placeholder="Use {customer_name}, {estimate_number}, etc."
                  data-testid="input-subject"
                />
              </div>

              <div>
                <Label data-testid="label-email-body">Email Body *</Label>
                <ReactQuill
                  value={formData.body}
                  onChange={(value) => setFormData({...formData, body: value})}
                  className="bg-white"
                  data-testid="textarea-email-body"
                  modules={{
                    toolbar: [
                      [{ 'header': [1, 2, 3, false] }],
                      ['bold', 'italic', 'underline'],
                      [{'list': 'ordered'}, {'list': 'bullet'}],
                      ['link'],
                      ['clean']
                    ]
                  }}
                />
              </div>

              <div className="bg-blue-50 p-4 rounded-lg" data-testid="section-merge-fields">
                <p className="font-semibold text-sm mb-2" data-testid="text-merge-fields-title">Available Merge Fields:</p>
                <div className="flex flex-wrap gap-2">
                  {['{company_name}', '{company_logo}', '{company_address}', '{company_phone}', 
                    '{customer_name}', '{customer_email}', '{estimate_number}', '{invoice_number}',
                    '{amount}', '{due_date}', '{project_name}'
                  ].map(field => (
                    <code key={field} className="bg-white px-2 py-1 rounded text-xs border" data-testid={`code-field-${field.replace(/[{}]/g, '')}`}>
                      {field}
                    </code>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={handleCloseDialog} data-testid="button-cancel">
                  {t.common.cancel}
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700" data-testid="button-submit">
                  {editingTemplate ? `${t.common.update} ${t.settings.templates}` : `${t.common.create} ${t.settings.templates}`}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Category Filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={selectedCategory === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory("all")}
              data-testid="button-filter-all"
            >
              {t.common.all} {t.settings.templates} ({templates.length})
            </Button>
            {Object.entries(categories).map(([key, cat]) => {
              const count = templates.filter(t => t.category === key).length;
              if (count === 0) return null;
              return (
                <Button
                  key={key}
                  variant={selectedCategory === key ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedCategory(key)}
                  data-testid={`button-filter-${key}`}
                >
                  {cat.name} ({count})
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Templates by Category */}
      {Object.entries(groupedTemplates).sort().map(([category, categoryTemplates]) => (
        <Card key={category} data-testid={`card-category-${category}`}>
          <CardHeader className="bg-gray-50 border-b">
            <CardTitle className="text-lg flex items-center gap-2" data-testid={`text-category-title-${category}`}>
              <Badge className={categories[category]?.color} data-testid={`badge-category-${category}`}>
                {categories[category]?.name || category}
              </Badge>
              <span className="text-sm text-gray-500" data-testid={`text-category-count-${category}`}>
                ({categoryTemplates.length} template{categoryTemplates.length !== 1 ? 's' : ''})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0" data-testid={`content-category-${category}`}>
            <div className="divide-y">
              {categoryTemplates.map((template) => (
                <div key={template.id} className="p-4 hover:bg-gray-50 flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Mail className="w-4 h-4 text-blue-600" />
                      <span className="font-semibold text-gray-900" data-testid={`text-template-name-${template.id}`}>{template.template_name}</span>
                      {template.is_default && (
                        <Badge variant="outline" className="text-xs" data-testid={`badge-system-default-${template.id}`}>System Default</Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-600" data-testid={`text-template-subject-${template.id}`}>{template.subject}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDuplicate(template)}
                      title="Duplicate"
                      data-testid={`button-duplicate-${template.id}`}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(template)}
                      data-testid={`button-edit-${template.id}`}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    {!template.is_default && template.company_id === myCompany?.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(template.id, template.is_default)}
                        className="text-red-600 hover:text-red-700"
                        data-testid={`button-delete-${template.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {filteredTemplates.length === 0 && (
        <Card data-testid="card-no-templates">
          <CardContent className="p-12 text-center text-gray-500">
            <Mail className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-semibold mb-2">{t.common.noResults}</p>
            <p>Create your first email template to get started!</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}