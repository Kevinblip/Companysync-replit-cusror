import React, { useState, useEffect } from "react";
import PdfViewer from "@/components/PdfViewer";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Save, ArrowLeft, Type, Calendar, Mail, Phone, DollarSign, FileSignature } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function ContractFieldEditor() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [templateId, setTemplateId] = useState(null);
  const [fields, setFields] = useState([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setTemplateId(params.get('templateId'));
  }, []);

  const { data: template } = useQuery({
    queryKey: ['contract-template', templateId],
    queryFn: async () => {
      const templates = await base44.entities.ContractTemplate.filter({ id: templateId });
      return templates[0];
    },
    enabled: !!templateId,
  });

  useEffect(() => {
    if (template?.fillable_fields) {
      setFields(template.fillable_fields);
    }
  }, [template]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return await base44.entities.ContractTemplate.update(template.id, {
        fillable_fields: fields
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contract-templates'] });
      alert('✅ Fields saved!');
      navigate(createPageUrl('ContractTemplates'));
    },
  });

  const addField = () => {
    const newField = {
      field_name: `field_${Date.now()}`,
      field_label: "New Field",
      field_type: "text",
      filled_by: "customer",
      required: false,
      placeholder: ""
    };
    setFields([...fields, newField]);
  };

  const updateField = (index, key, value) => {
    const newFields = [...fields];
    newFields[index][key] = value;
    setFields(newFields);
  };

  const removeField = (index) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const getFieldIcon = (type) => {
    switch (type) {
      case 'signature': return <FileSignature className="w-4 h-4" />;
      case 'date': return <Calendar className="w-4 h-4" />;
      case 'email': return <Mail className="w-4 h-4" />;
      case 'phone': return <Phone className="w-4 h-4" />;
      case 'currency': return <DollarSign className="w-4 h-4" />;
      default: return <Type className="w-4 h-4" />;
    }
  };

  if (!template) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => navigate(createPageUrl('ContractTemplates'))}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Edit Fields</h1>
            <p className="text-gray-500 mt-1">{template.template_name}</p>
          </div>
        </div>
        <Button onClick={() => saveMutation.mutate()} className="bg-blue-600 hover:bg-blue-700">
          <Save className="w-4 h-4 mr-2" />
          Save Fields
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fields Editor */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Fillable Fields</CardTitle>
                <Button onClick={addField} size="sm">Add Field</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 max-h-[600px] overflow-y-auto">
              {fields.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p className="mb-4">No fields yet</p>
                  <Button onClick={addField} variant="outline">Add First Field</Button>
                </div>
              ) : (
                fields.map((field, index) => (
                  <Card key={index} className="bg-gray-50">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline">Field {index + 1}</Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeField(index)}
                          className="text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>

                      <div>
                        <Label className="text-xs">Field Label</Label>
                        <Input
                          value={field.field_label}
                          onChange={(e) => updateField(index, 'field_label', e.target.value)}
                          placeholder="e.g., Customer Name"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Field Type</Label>
                          <Select
                            value={field.field_type}
                            onValueChange={(value) => updateField(index, 'field_type', value)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">
                                <div className="flex items-center gap-2">
                                  <Type className="w-4 h-4" />
                                  Text
                                </div>
                              </SelectItem>
                              <SelectItem value="date">
                                <div className="flex items-center gap-2">
                                  <Calendar className="w-4 h-4" />
                                  Date
                                </div>
                              </SelectItem>
                              <SelectItem value="email">
                                <div className="flex items-center gap-2">
                                  <Mail className="w-4 h-4" />
                                  Email
                                </div>
                              </SelectItem>
                              <SelectItem value="phone">
                                <div className="flex items-center gap-2">
                                  <Phone className="w-4 h-4" />
                                  Phone
                                </div>
                              </SelectItem>
                              <SelectItem value="currency">
                                <div className="flex items-center gap-2">
                                  <DollarSign className="w-4 h-4" />
                                  Currency
                                </div>
                              </SelectItem>
                              <SelectItem value="signature">
                                <div className="flex items-center gap-2">
                                  <FileSignature className="w-4 h-4" />
                                  Signature
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs">Filled By</Label>
                          <Select
                            value={field.filled_by}
                            onValueChange={(value) => updateField(index, 'filled_by', value)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="rep">Rep/Staff</SelectItem>
                              <SelectItem value="customer">Customer</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={field.required || false}
                          onChange={(e) => updateField(index, 'required', e.target.checked)}
                          className="w-4 h-4"
                        />
                        <Label className="text-xs cursor-pointer">Required</Label>
                      </div>

                      <div>
                        <Label className="text-xs">Placeholder (optional)</Label>
                        <Input
                          value={field.placeholder || ''}
                          onChange={(e) => updateField(index, 'placeholder', e.target.value)}
                          placeholder="Enter hint text..."
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* PDF Preview */}
        <div className="sticky top-6">
          <Card className="h-[700px]">
            <CardHeader className="border-b bg-gray-50">
              <CardTitle>PDF Preview</CardTitle>
            </CardHeader>
            <CardContent className="p-0 h-[640px] flex flex-col">
              <PdfViewer
                src={`/api/proxy-pdf?url=${encodeURIComponent(template.original_file_url || '')}`}
                className="w-full flex-1 border-0"
                title="Contract Preview"
              />
              <div className="text-center py-1 bg-gray-50 border-t">
                <a href={template.original_file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                  Open in new tab ↗
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800">
          <strong>💡 Tip:</strong> Add all the fields you need, then click "Save Fields". When you use this template, the rep fills their fields first, then it's sent to the customer.
        </p>
      </div>
    </div>
  );
}