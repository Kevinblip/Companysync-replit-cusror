import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { createPageUrl } from '@/utils';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Star, Briefcase, Mail, Phone, CheckCircle, Edit, Trash2, MoreVertical, UserX, UserCheck, Building2, UserCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const InspectorCard = ({ inspector, onEdit, onToggleActive, onDelete }) => {
    const isInternal = inspector.source === 'staff';
    
    return (
        <Card className="shadow-lg hover:shadow-xl transition-shadow duration-300 flex flex-col">
            <CardHeader className="flex flex-row items-start gap-4 p-4">
                <img 
                    src={inspector.avatar_url || `https://avatar.vercel.sh/${inspector.email}.png`} 
                    alt={inspector.full_name} 
                    className="w-16 h-16 rounded-full border-2 border-white shadow-md" 
                />
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <CardTitle className="text-xl">{inspector.full_name}</CardTitle>
                        {isInternal && (
                            <Badge className="bg-blue-100 text-blue-700 text-xs">
                                <Building2 className="w-3 h-3 mr-1" />
                                Staff
                            </Badge>
                        )}
                        {!isInternal && (
                            <Badge className="bg-green-100 text-green-700 text-xs">
                                <UserCircle className="w-3 h-3 mr-1" />
                                Contractor
                            </Badge>
                        )}
                    </div>
                    <p className="text-sm text-gray-500">{inspector.position}</p>
                    <div className="flex items-center gap-1 text-yellow-500 mt-1">
                        <Star className="w-4 h-4 fill-current" />
                        <span className="text-sm font-semibold">
                            {inspector.rating || 'N/A'} ({inspector.inspection_count || 0} inspections)
                        </span>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-4 flex-grow space-y-3">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Briefcase className="w-4 h-4" />
                    <span>{inspector.experience_years || 'N/A'}+ Years</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Mail className="w-4 h-4" />
                    <a href={`mailto:${inspector.email}`} className="truncate hover:underline">{inspector.email}</a>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Phone className="w-4 h-4" />
                    <span>{inspector.phone || 'Not available'}</span>
                </div>
                <p className="text-sm text-gray-700 pt-2 border-t border-gray-100 line-clamp-3">
                    {inspector.notes || 'Experienced property inspector specializing in storm damage assessment.'}
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                    {inspector.certifications?.map(cert => (
                        <Badge key={cert} variant="secondary">{cert}</Badge>
                    ))}
                </div>
            </CardContent>
            <CardFooter className="flex justify-between items-center bg-gray-50 p-4">
                <div className="flex items-center gap-2">
                    {inspector.is_verified ? (
                        <>
                            <CheckCircle className="w-5 h-5 text-green-500" />
                            <span className="text-sm font-medium text-green-700">Verified</span>
                        </>
                    ) : (
                        <span className="text-sm text-gray-500">Not verified</span>
                    )}
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                            Actions <MoreVertical className="w-4 h-4 ml-2" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(inspector)}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onToggleActive(inspector)}>
                            {inspector.is_active ? <UserX className="w-4 h-4 mr-2" /> : <UserCheck className="w-4 h-4 mr-2" />}
                            {inspector.is_active ? 'Set as Inactive' : 'Set as Active'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-red-600" onClick={() => onDelete(inspector)} disabled={isInternal}>
                            <Trash2 className="w-4 h-4 mr-2" />
                            {isInternal ? 'Delete via Staff Management' : 'Delete'}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </CardFooter>
        </Card>
    );
};

export default function Inspectors() {
    const [showDialog, setShowDialog] = useState(false);
    const [editingInspector, setEditingInspector] = useState(null);
    const [activeTab, setActiveTab] = useState('all');
    const [formData, setFormData] = useState({
        full_name: '',
        email: '',
        phone: '',
        position: '',
        experience_years: 0,
        certifications: [],
        notes: '',
        inspector_type: 'contractor',
        hourly_rate: 0,
        is_verified: false,
        avatar_url: '',
    });
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const queryClient = useQueryClient();
    const navigate = useNavigate();

    const [user, setUser] = useState(null);
    useEffect(() => {
        base44.auth.me().then(setUser).catch(() => {});
    }, []);

    const { company: myCompany } = useCurrentCompany(user);

    const { data: staffProfiles = [] } = useQuery({
        queryKey: ['staffProfiles', myCompany?.id],
        queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
        enabled: !!myCompany,
        initialData: []
    });
    
    const { data: inspectorProfiles = [] } = useQuery({
        queryKey: ['inspectorProfiles', myCompany?.id],
        queryFn: () => myCompany ? base44.entities.InspectorProfile.filter({ company_id: myCompany.id }) : [],
        enabled: !!myCompany,
        initialData: []
    });

    const { data: users = [] } = useQuery({
        queryKey: ['users'],
        queryFn: () => base44.entities.User.list(),
        initialData: []
    });

    const createInspectorMutation = useMutation({
        mutationFn: (data) => base44.entities.InspectorProfile.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inspectorProfiles'] });
            setShowDialog(false);
            resetForm();
        },
    });

    const updateInspectorMutation = useMutation({
        mutationFn: ({ id, data }) => base44.entities.InspectorProfile.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inspectorProfiles'] });
            setShowDialog(false);
            resetForm();
        },
    });
    
    const deleteInspectorMutation = useMutation({
        mutationFn: (id) => base44.entities.InspectorProfile.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inspectorProfiles'] });
        },
    });

    const updateStaffProfileMutation = useMutation({
        mutationFn: ({ id, data }) => base44.entities.StaffProfile.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['staffProfiles'] });
        },
    });

    // Combine both types into unified list
    const allInspectors = [
        // Internal staff
        ...staffProfiles.map(profile => {
            const user = users.find(u => u.email === profile.user_email);
            return {
                id: profile.id,
                source: 'staff',
                full_name: profile.full_name || user?.full_name,
                email: profile.user_email,
                phone: profile.phone,
                position: profile.position,
                avatar_url: profile.avatar_url,
                experience_years: profile.experience_years,
                certifications: profile.tags || [],
                notes: profile.social_facebook,
                inspection_count: profile.inspection_count || 0,
                rating: profile.rating,
                is_active: profile.is_active ?? true,
                is_verified: true,
                hourly_rate: profile.hourly_rate,
            };
        }),
        // External contractors
        ...inspectorProfiles.map(profile => ({
            id: profile.id,
            source: 'inspector',
            full_name: profile.full_name,
            email: profile.email,
            phone: profile.phone,
            position: profile.position,
            avatar_url: profile.avatar_url,
            experience_years: profile.experience_years,
            certifications: profile.certifications || [],
            notes: profile.notes,
            inspection_count: profile.inspection_count || 0,
            rating: profile.rating,
            is_active: profile.is_active ?? true,
            is_verified: profile.is_verified ?? false,
            inspector_type: profile.inspector_type,
            hourly_rate: profile.hourly_rate,
        }))
    ];

    const filteredInspectors = allInspectors.filter(inspector => {
        if (activeTab === 'all') return true;
        if (activeTab === 'staff') return inspector.source === 'staff';
        if (activeTab === 'contractors') return inspector.source === 'inspector';
        return true;
    });

    const resetForm = () => {
        setFormData({
            full_name: '',
            email: '',
            phone: '',
            position: '',
            experience_years: 0,
            certifications: [],
            notes: '',
            inspector_type: 'contractor',
            hourly_rate: 0,
            is_verified: false,
            avatar_url: '',
        });
        setEditingInspector(null);
    };

    const handlePhotoUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploadingPhoto(true);
        try {
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            setFormData(prev => ({ ...prev, avatar_url: file_url }));
        } catch (error) {
            alert('Failed to upload photo: ' + error.message);
        }
        setIsUploadingPhoto(false);
    };

    const handleEdit = (inspector) => {
        if (inspector.source === 'staff') {
            // Redirect to staff management for internal staff
            navigate(createPageUrl('StaffProfilePage') + `?email=${encodeURIComponent(inspector.email)}`);
            return;
        }

        setEditingInspector(inspector);
        setFormData({
            full_name: inspector.full_name,
            email: inspector.email,
            phone: inspector.phone || '',
            position: inspector.position || '',
            experience_years: inspector.experience_years || 0,
            certifications: inspector.certifications || [],
            notes: inspector.notes || '',
            inspector_type: inspector.inspector_type || 'contractor',
            hourly_rate: inspector.hourly_rate || 0,
            is_verified: inspector.is_verified || false,
            avatar_url: inspector.avatar_url || '',
        });
        setShowDialog(true);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const dataToSave = {
            ...formData,
            certifications: typeof formData.certifications === 'string' 
                ? formData.certifications.split(',').map(t => t.trim()) 
                : formData.certifications
        };
        
        if (editingInspector) {
            updateInspectorMutation.mutate({ id: editingInspector.id, data: dataToSave });
        } else {
            createInspectorMutation.mutate(dataToSave);
        }
    };

    const handleToggleActive = (inspector) => {
        if (inspector.source === 'staff') {
            updateStaffProfileMutation.mutate({
                id: inspector.id,
                data: { is_active: !inspector.is_active }
            });
        } else {
            updateInspectorMutation.mutate({
                id: inspector.id,
                data: { is_active: !inspector.is_active }
            });
        }
    };
    
    const handleDelete = (inspector) => {
        if (inspector.source === 'staff') {
            alert('❌ Cannot delete internal staff from here.\n\nInternal staff members must be managed through Staff Management.\n\nGo to: Settings → Staff Management');
            return;
        }

        if (window.confirm(`Are you sure you want to delete contractor "${inspector.full_name}"? This action cannot be undone.`)) {
            deleteInspectorMutation.mutate(inspector.id);
        }
    };

    return (
        <div className="p-2 md:p-6 bg-gray-50 min-h-screen">
            <div className="max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">Inspector Network</h1>
                        <p className="text-gray-500 mt-1">Manage your internal staff and contractor inspectors</p>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => navigate(createPageUrl('StaffManagement'))}>
                            <Building2 className="w-4 h-4 mr-2" />
                            Manage Staff
                        </Button>
                        <Button onClick={() => { resetForm(); setShowDialog(true); }}>
                            <Plus className="mr-2 h-4 w-4" /> Add Contractor
                        </Button>
                    </div>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
                    <TabsList className="grid w-full max-w-md grid-cols-3">
                        <TabsTrigger value="all">All ({allInspectors.length})</TabsTrigger>
                        <TabsTrigger value="staff">
                            Internal Staff ({staffProfiles.length})
                        </TabsTrigger>
                        <TabsTrigger value="contractors">
                            Contractors ({inspectorProfiles.length})
                        </TabsTrigger>
                    </TabsList>
                </Tabs>

                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {filteredInspectors.map(inspector => (
                        <InspectorCard 
                            key={`${inspector.source}-${inspector.id}`}
                            inspector={inspector} 
                            onEdit={handleEdit} 
                            onToggleActive={handleToggleActive} 
                            onDelete={handleDelete} 
                        />
                    ))}
                </div>

                {filteredInspectors.length === 0 && (
                    <div className="text-center py-12">
                        <UserCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-semibold text-gray-700 mb-2">No Inspectors Found</h3>
                        <p className="text-gray-500 mb-4">
                            {activeTab === 'staff' && 'Add staff members in Staff Management first'}
                            {activeTab === 'contractors' && 'Add your first contractor inspector'}
                            {activeTab === 'all' && 'Get started by adding inspectors'}
                        </p>
                        {activeTab === 'contractors' && (
                            <Button onClick={() => { resetForm(); setShowDialog(true); }}>
                                <Plus className="mr-2 h-4 w-4" /> Add Contractor
                            </Button>
                        )}
                        {activeTab === 'staff' && (
                            <Button onClick={() => navigate(createPageUrl('StaffManagement'))}>
                                <Building2 className="w-4 h-4 mr-2" />
                                Go to Staff Management
                            </Button>
                        )}
                    </div>
                )}
            </div>

            <Dialog open={showDialog} onOpenChange={(open) => { if (!open) resetForm(); setShowDialog(open); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingInspector ? 'Edit' : 'Add'} Contractor Inspector</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <Label>Inspector Photo</Label>
                            <div className="flex items-center gap-4 mt-2">
                                {formData.avatar_url ? (
                                    <img 
                                        src={formData.avatar_url} 
                                        alt="Inspector" 
                                        className="w-20 h-20 rounded-full object-cover border-2 border-gray-200"
                                    />
                                ) : (
                                    <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center">
                                        <UserCircle className="w-12 h-12 text-gray-400" />
                                    </div>
                                )}
                                <div className="flex-1">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => document.getElementById('inspector-photo-upload').click()}
                                        disabled={isUploadingPhoto}
                                    >
                                        {isUploadingPhoto ? 'Uploading...' : 'Upload Photo'}
                                    </Button>
                                    <input
                                        id="inspector-photo-upload"
                                        type="file"
                                        accept="image/*"
                                        onChange={handlePhotoUpload}
                                        className="hidden"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Professional headshot recommended</p>
                                </div>
                            </div>
                        </div>
                        <div>
                            <Label>Full Name *</Label>
                            <Input value={formData.full_name} onChange={(e) => setFormData(prev => ({...prev, full_name: e.target.value}))} required />
                        </div>
                        <div>
                            <Label>Email *</Label>
                            <Input type="email" value={formData.email} onChange={(e) => setFormData(prev => ({...prev, email: e.target.value}))} required />
                        </div>
                        <div>
                            <Label>Phone Number</Label>
                            <Input value={formData.phone} onChange={(e) => setFormData(prev => ({...prev, phone: e.target.value}))} placeholder="+12163318323" />
                        </div>
                        <div>
                            <Label>Position / Title</Label>
                            <Input value={formData.position} onChange={(e) => setFormData(prev => ({...prev, position: e.target.value}))} placeholder="e.g., HAAG Certified Inspector" />
                        </div>
                        <div>
                            <Label>Inspector Type</Label>
                            <Select value={formData.inspector_type} onValueChange={(val) => setFormData(prev => ({...prev, inspector_type: val}))}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="contractor">Independent Contractor</SelectItem>
                                    <SelectItem value="1099">1099 Worker</SelectItem>
                                    <SelectItem value="vendor">Vendor/Company</SelectItem>
                                    <SelectItem value="partner">Partner</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label>Years of Experience</Label>
                            <Input type="number" value={formData.experience_years} onChange={(e) => setFormData(prev => ({...prev, experience_years: parseInt(e.target.value, 10) || 0}))} />
                        </div>
                        <div>
                            <Label>Hourly Rate ($)</Label>
                            <Input type="number" step="0.01" value={formData.hourly_rate} onChange={(e) => setFormData(prev => ({...prev, hourly_rate: parseFloat(e.target.value) || 0}))} />
                        </div>
                        <div>
                            <Label>Certifications (comma-separated)</Label>
                            <Input value={Array.isArray(formData.certifications) ? formData.certifications.join(', ') : formData.certifications} onChange={(e) => setFormData(prev => ({...prev, certifications: e.target.value}))} placeholder="HAAG Certified, Licensed, etc." />
                        </div>
                        <div>
                            <Label>Notes / Bio</Label>
                            <Textarea value={formData.notes} onChange={(e) => setFormData(prev => ({...prev, notes: e.target.value}))} placeholder="Additional information..." />
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch checked={formData.is_verified} onCheckedChange={(val) => setFormData(prev => ({...prev, is_verified: val}))} />
                            <Label>Mark as Verified</Label>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => { resetForm(); setShowDialog(false); }}>Cancel</Button>
                            <Button type="submit">{editingInspector ? 'Save Changes' : 'Add Inspector'}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}