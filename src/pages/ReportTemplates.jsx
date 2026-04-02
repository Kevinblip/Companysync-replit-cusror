import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Plus, FileText, Edit, Trash2, Star, Building2, Eye } from 'lucide-react';
import StateFarmPreview from "@/components/report-templates/StateFarmPreview";
import PreviewErrorBoundary from "@/components/report-templates/PreviewErrorBoundary";

export default function ReportTemplates() {
    const [showDialog, setShowDialog] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState(null);
    const [previewingTemplate, setPreviewingTemplate] = useState(null);
    const [formData, setFormData] = useState({
        template_name: '',
        insurance_carrier: '',
        description: '',
        layout_style: 'standard',
        photo_layout: '2_per_page',
        estimate_format: 'line_items_table',
        include_sections: {
            cover_page: true,
            executive_summary: false,
            property_details: true,
            damage_assessment: true,
            photos_by_section: true,
            xactimate_estimate: true,
            storm_data: true,
            inspector_certification: true,
            recommendations: false
        },
        show_photo_captions: true,
        branding: {
            show_company_logo: true,
            primary_color: '#3b82f6',
            header_text: '',
            footer_text: ''
        },
        is_default: false,
        is_active: true
    });

    const queryClient = useQueryClient();

    const { data: user } = useQuery({
        queryKey: ['user'],
        queryFn: () => base44.auth.me(),
    });

    const { data: companies = [] } = useQuery({
        queryKey: ['companies'],
        queryFn: () => base44.entities.Company.list('-created_date'),
        initialData: []
    });

    const myCompany = companies.find(c => c.created_by === user?.email);

    const { data: templates = [] } = useQuery({
        queryKey: ['report-templates', myCompany?.id],
        queryFn: () => myCompany ? base44.entities.InspectionReportTemplate.filter({ company_id: myCompany.id }) : [],
        enabled: !!myCompany,
        initialData: [],
        retry: false,
    });

    const createMutation = useMutation({
        mutationFn: (data) => base44.entities.InspectionReportTemplate.create({ ...data, company_id: myCompany.id }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['report-templates', myCompany?.id] });
            setShowDialog(false);
            resetForm();
        }
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => base44.entities.InspectionReportTemplate.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['report-templates', myCompany?.id] });
            setShowDialog(false);
            resetForm();
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => base44.entities.InspectionReportTemplate.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['report-templates'] });
        }
    });

    const resetForm = () => {
        setFormData({
            template_name: '',
            insurance_carrier: '',
            description: '',
            layout_style: 'standard',
            photo_layout: '2_per_page',
            estimate_format: 'line_items_table',
            include_sections: {
                cover_page: true,
                executive_summary: false,
                property_details: true,
                damage_assessment: true,
                photos_by_section: true,
                xactimate_estimate: true,
                storm_data: true,
                inspector_certification: true,
                recommendations: false
            },
            show_photo_captions: true,
            branding: {
                show_company_logo: true,
                primary_color: '#3b82f6',
                header_text: '',
                footer_text: ''
            },
            is_default: false,
            is_active: true
        });
        setEditingTemplate(null);
    };

    const handleEdit = (template) => {
        setEditingTemplate(template);
        setFormData({
            ...template,
            include_sections: template.include_sections || {
                cover_page: true,
                executive_summary: false,
                property_details: true,
                damage_assessment: true,
                photos_by_section: true,
                xactimate_estimate: true,
                storm_data: true,
                inspector_certification: true,
                recommendations: false
            },
            branding: template.branding || {
                show_company_logo: true,
                primary_color: '#3b82f6',
                header_text: '',
                footer_text: ''
            }
        });
        setShowDialog(true);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const payload = {
            ...formData,
            include_sections: formData.include_sections || {
                cover_page: true,
                executive_summary: false,
                property_details: true,
                damage_assessment: true,
                photos_by_section: true,
                xactimate_estimate: true,
                storm_data: true,
                inspector_certification: true,
                recommendations: false
            },
            branding: formData.branding || {
                show_company_logo: true,
                primary_color: '#3b82f6',
                header_text: '',
                footer_text: ''
            }
        };
        if (editingTemplate) {
            updateMutation.mutate({ id: editingTemplate.id, data: payload });
        } else {
            createMutation.mutate(payload);
        }
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Inspection Report Templates</h1>
                        <p className="text-gray-500 mt-1">Create custom templates optimized for different insurance carriers</p>
                    </div>
                    <Button onClick={() => { resetForm(); setShowDialog(true); }}>
                        <Plus className="w-4 h-4 mr-2" />
                        New Template
                    </Button>
                </div>

                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {templates.map(template => (
                        <Card key={template.id} className={template.is_default ? 'border-2 border-blue-500' : ''}>
                            <CardHeader>
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <CardTitle className="text-lg flex items-center gap-2">
                                            <FileText className="w-5 h-5" />
                                            {template.template_name}
                                        </CardTitle>
                                        {template.insurance_carrier && (
                                            <div className="flex items-center gap-2 mt-2">
                                                <Building2 className="w-4 h-4 text-gray-500" />
                                                <span className="text-sm text-gray-600">{template.insurance_carrier}</span>
                                            </div>
                                        )}
                                    </div>
                                    {template.is_default && (
                                        <Badge className="bg-blue-100 text-blue-700">
                                            <Star className="w-3 h-3 mr-1" />
                                            Default
                                        </Badge>
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <p className="text-sm text-gray-600">{template.description || 'No description'}</p>
                                <div className="flex items-center gap-4 text-sm text-gray-500">
                                    <span>📄 {(template.photo_layout || '2_per_page').replace(/_/g, ' ')}</span>
                                    <span>📊 {template.layout_style || 'standard'}</span>
                                </div>
                                <div className="flex gap-2 pt-3 border-t">
                                    <Button size="sm" variant="outline" onClick={() => setPreviewingTemplate(template)} className="flex-1">
                                        <Eye className="w-3 h-3 mr-1" />
                                        Preview
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => handleEdit(template)} className="flex-1">
                                        <Edit className="w-3 h-3 mr-1" />
                                        Edit
                                    </Button>
                                    <Button 
                                        size="sm" 
                                        variant="outline" 
                                        onClick={() => {
                                            if (window.confirm('Delete this template?')) {
                                                deleteMutation.mutate(template.id);
                                            }
                                        }}
                                        className="text-red-600"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}

                    {templates.length === 0 && (
                        <div className="col-span-full text-center py-12">
                            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-700 mb-2">No Templates Yet</h3>
                            <p className="text-gray-500 mb-4">Create your first custom report template</p>
                            <Button onClick={() => { resetForm(); setShowDialog(true); }}>
                                <Plus className="w-4 h-4 mr-2" />
                                Create Template
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            <Dialog open={showDialog} onOpenChange={(open) => { if (!open) resetForm(); setShowDialog(open); }}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingTemplate ? 'Edit' : 'Create'} Report Template</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Template Name *</Label>
                                <Input
                                    value={formData.template_name}
                                    onChange={(e) => setFormData({...formData, template_name: e.target.value})}
                                    placeholder="e.g., State Farm Standard"
                                    required
                                />
                            </div>
                            <div>
                                <Label>Insurance Carrier</Label>
                                <Input
                                    value={formData.insurance_carrier}
                                    onChange={(e) => setFormData({...formData, insurance_carrier: e.target.value})}
                                    placeholder="e.g., State Farm, Allstate"
                                />
                            </div>
                        </div>

                        <div>
                            <Label>Description</Label>
                            <Textarea
                                value={formData.description}
                                onChange={(e) => setFormData({...formData, description: e.target.value})}
                                placeholder="What makes this template unique..."
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Layout Style</Label>
                                <Select value={formData.layout_style} onValueChange={(v) => setFormData({...formData, layout_style: v})}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="standard">Standard</SelectItem>
                                        <SelectItem value="detailed">Detailed</SelectItem>
                                        <SelectItem value="summary">Summary</SelectItem>
                                        <SelectItem value="carrier_specific">Carrier Specific</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label>Photos Per Page</Label>
                                <Select value={formData.photo_layout} onValueChange={(v) => setFormData({...formData, photo_layout: v})}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1_per_page">1 per page</SelectItem>
                                        <SelectItem value="2_per_page">2 per page</SelectItem>
                                        <SelectItem value="4_per_page">4 per page</SelectItem>
                                        <SelectItem value="6_per_page">6 per page</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div>
                            <Label className="mb-3 block">Include Sections</Label>
                            <div className="grid grid-cols-2 gap-3">
                                {Object.entries(formData.include_sections).map(([key, value]) => (
                                    <div key={key} className="flex items-center space-x-2">
                                        <Switch
                                            checked={value}
                                            onCheckedChange={(checked) => setFormData({
                                                ...formData,
                                                include_sections: { ...formData.include_sections, [key]: checked }
                                            })}
                                        />
                                        <Label className="capitalize cursor-pointer">
                                            {key.replace(/_/g, ' ')}
                                        </Label>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center space-x-2 pt-4 border-t">
                            <Switch
                                checked={formData.is_default}
                                onCheckedChange={(checked) => setFormData({...formData, is_default: checked})}
                            />
                            <Label className="cursor-pointer">Set as Default Template</Label>
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => { resetForm(); setShowDialog(false); }}>
                                Cancel
                            </Button>
                            <Button type="submit">
                                {editingTemplate ? 'Save Changes' : 'Create Template'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={!!previewingTemplate} onOpenChange={(open) => !open && setPreviewingTemplate(null)}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Eye className="w-5 h-5" />
                            Preview: {previewingTemplate?.template_name}
                        </DialogTitle>
                    </DialogHeader>
                    {previewingTemplate && (
                        <PreviewErrorBoundary>
                            <div className="space-y-6">
                            <div className="bg-gray-50 p-6 rounded-lg border-2 border-gray-200">
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                            <Building2 className="w-5 h-5" />
                                            {previewingTemplate.insurance_carrier || 'General Template'}
                                        </h3>
                                        <p className="text-sm text-gray-600 mt-1">{previewingTemplate.description}</p>
                                    </div>
                                    {previewingTemplate.is_default && (
                                        <Badge className="bg-blue-100 text-blue-700">
                                            <Star className="w-3 h-3 mr-1" />
                                            Default
                                        </Badge>
                                    )}
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <h4 className="font-semibold text-gray-700 mb-3">Layout Settings</h4>
                                    <div className="space-y-2 bg-white p-4 rounded border">
                                        <div className="flex justify-between">
                                            <span className="text-sm text-gray-600">Layout Style:</span>
                                            <Badge variant="outline">{previewingTemplate.layout_style}</Badge>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-sm text-gray-600">Photos Per Page:</span>
                                            <Badge variant="outline">{(previewingTemplate.photo_layout || '2_per_page').replace(/_/g, ' ')}</Badge>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-sm text-gray-600">Photo Captions:</span>
                                            <Badge variant="outline">{previewingTemplate.show_photo_captions ? 'Yes' : 'No'}</Badge>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-sm text-gray-600">Estimate Format:</span>
                                            <Badge variant="outline">{(previewingTemplate.estimate_format || 'line_items_table').replace(/_/g, ' ')}</Badge>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <h4 className="font-semibold text-gray-700 mb-3">Included Sections</h4>
                                    <div className="space-y-2 bg-white p-4 rounded border">
                                        {previewingTemplate.include_sections ? (
                                            Object.entries(previewingTemplate.include_sections).map(([key, value]) => (
                                                <div key={key} className="flex items-center justify-between">
                                                    <span className="text-sm text-gray-600 capitalize">{key.replace(/_/g, ' ')}</span>
                                                    {value ? (
                                                        <Badge className="bg-green-100 text-green-700">✓ Included</Badge>
                                                    ) : (
                                                        <Badge variant="outline" className="text-gray-400">Not included</Badge>
                                                    )}
                                                </div>
                                            ))
                                        ) : (
                                            <p className="text-sm text-gray-500">All sections included by default</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-6 rounded-lg border">
                                <h4 className="font-semibold text-gray-700 mb-3">Report Preview</h4>
                                <div className="bg-white rounded shadow-lg p-8 border-4 border-gray-200">
                                    {(((previewingTemplate.template_name || '').toLowerCase().includes('state farm')) || ((previewingTemplate.insurance_carrier || '').toLowerCase().includes('state farm'))) && (
                                        <StateFarmPreview template={previewingTemplate} />
                                    )}
                                    <div className="text-center mb-6">
                                        <div className="text-xs text-gray-500 mb-2">COVER PAGE</div>
                                        <h2 className="text-2xl font-bold text-gray-900">Property Inspection Report</h2>
                                        <p className="text-sm text-gray-600 mt-2">{previewingTemplate.insurance_carrier || 'Insurance Carrier'}</p>
                                    </div>

                                    <div className="space-y-4 text-sm">
                                        {previewingTemplate.include_sections?.property_details !== false && (
                                            <div className="border-l-4 border-blue-500 pl-3">
                                                <strong>Property Details</strong>
                                                <p className="text-gray-600 text-xs mt-1">Property owner information and address</p>
                                            </div>
                                        )}
                                        {previewingTemplate.include_sections?.damage_assessment !== false && (
                                            <div className="border-l-4 border-red-500 pl-3">
                                                <strong>Damage Assessment</strong>
                                                <p className="text-gray-600 text-xs mt-1">Detailed analysis of damage found</p>
                                            </div>
                                        )}
                                        {previewingTemplate.include_sections?.photos_by_section !== false && (
                                            <div className="border-l-4 border-green-500 pl-3">
                                                <strong>Photo Documentation</strong>
                                                <p className="text-gray-600 text-xs mt-1">Visual evidence ({(previewingTemplate.photo_layout || '2_per_page').replace(/_/g, ' ')})</p>
                                            </div>
                                        )}
                                        {previewingTemplate.include_sections?.xactimate_estimate !== false && (
                                            <div className="border-l-4 border-purple-500 pl-3">
                                                <strong>Cost Estimate</strong>
                                                <p className="text-gray-600 text-xs mt-1">Format: {(previewingTemplate.estimate_format || 'line_items_table').replace(/_/g, ' ')}</p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-6 pt-4 border-t text-center text-xs text-gray-500">
                                        Inspector Certification & Company Information
                                    </div>
                                </div>
                            </div>
                        </div>
                        </PreviewErrorBoundary>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}