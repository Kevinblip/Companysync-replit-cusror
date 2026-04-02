import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import useTranslation from "@/hooks/useTranslation";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Plus, Users, MapPin, Phone, Mail, DollarSign, Star,
  Wrench, CheckCircle, XCircle, Edit, Trash2, Navigation,
  Upload, FileText, AlertTriangle, Calendar
} from 'lucide-react';
import { toast } from 'sonner';
import GooglePlacesAutocomplete from '../components/common/GooglePlacesAutocomplete';
import useCurrentCompany from "@/components/hooks/useCurrentCompany";

export default function Subcontractors() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editingSubcontractor, setEditingSubcontractor] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterActive, setFilterActive] = useState('all');
  const [selectedSubForJobs, setSelectedSubForJobs] = useState(null);
  const [showJobHistory, setShowJobHistory] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    contact_person: '',
    email: '',
    phone: '',
    phone_2: '',
    base_address: '',
    base_city: '',
    base_state: '',
    base_zip: '',
    base_latitude: null,
    base_longitude: null,
    service_radius_miles: 30,
    specialty: [],
    hourly_rate: '',
    per_sq_rate: '',
    per_job_rate: '',
    payment_method_preference: 'check',
    bank_account: '',
    routing_number: '',
    tax_id: '',
    insurance_verified: false,
    insurance_expiration: '',
    insurance_document_url: '',
    license_number: '',
    is_active: true,
    rating: 0,
    notes: ''
  });

  const [googleMapsApiKey, setGoogleMapsApiKey] = useState(null);

  const queryClient = useQueryClient();

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  useEffect(() => {
    base44.functions.invoke('getGoogleMapsApiKey')
      .then(response => setGoogleMapsApiKey(response.data.apiKey))
      .catch(err => console.error('Failed to load Google Maps API key:', err));
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  const { data: subcontractors = [] } = useQuery({
    queryKey: ['subcontractors', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Subcontractor.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Task.filter({ company_id: myCompany.id }, '-created_date', 500) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: allPayouts = [] } = useQuery({
    queryKey: ['payouts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payout.filter({ company_id: myCompany.id }, '-created_date', 500) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const getSubcontractorJobs = (subId, subEmail) => {
    const tasks = allTasks.filter(t => 
      t.assignees?.some(a => a.email === subEmail || a.email === subId)
    );
    const payouts = allPayouts.filter(p => p.recipient_id === subId);
    return { tasks, payouts };
  };

  const createMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.entities.Subcontractor.create({
        ...data,
        company_id: myCompany.id,
        specialty: data.specialty || [],
        hourly_rate: data.hourly_rate ? parseFloat(data.hourly_rate) : null,
        per_sq_rate: data.per_sq_rate ? parseFloat(data.per_sq_rate) : null,
        per_job_rate: data.per_job_rate ? parseFloat(data.per_job_rate) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subcontractors'] });
      setShowDialog(false);
      resetForm();
      toast.success('Subcontractor added successfully!');
    },
    onError: (error) => {
      toast.error(`Failed to add subcontractor: ${error.message}`);
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      return await base44.entities.Subcontractor.update(id, {
        ...data,
        hourly_rate: data.hourly_rate ? parseFloat(data.hourly_rate) : null,
        per_sq_rate: data.per_sq_rate ? parseFloat(data.per_sq_rate) : null,
        per_job_rate: data.per_job_rate ? parseFloat(data.per_job_rate) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subcontractors'] });
      setShowDialog(false);
      setEditingSubcontractor(null);
      resetForm();
      toast.success('Subcontractor updated successfully!');
    },
    onError: (error) => {
      toast.error(`Failed to update subcontractor: ${error.message}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      return await base44.entities.Subcontractor.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subcontractors'] });
      toast.success('Subcontractor deleted successfully!');
    },
    onError: (error) => {
      toast.error(`Failed to delete subcontractor: ${error.message}`);
    }
  });

  const resetForm = () => {
    setFormData({
      name: '',
      contact_person: '',
      email: '',
      phone: '',
      phone_2: '',
      base_address: '',
      base_city: '',
      base_state: '',
      base_zip: '',
      base_latitude: null,
      base_longitude: null,
      service_radius_miles: 30,
      specialty: [],
      hourly_rate: '',
      per_sq_rate: '',
      per_job_rate: '',
      payment_method_preference: 'check',
      bank_account: '',
      routing_number: '',
      tax_id: '',
      insurance_verified: false,
      insurance_expiration: '',
      license_number: '',
      is_active: true,
      rating: 0,
      notes: ''
    });
  };

  const handleEdit = (sub) => {
    setEditingSubcontractor(sub);
    setFormData({
      name: sub.name || '',
      contact_person: sub.contact_person || '',
      email: sub.email || '',
      phone: sub.phone || '',
      phone_2: sub.phone_2 || '',
      base_address: sub.base_address || '',
      base_city: sub.base_city || '',
      base_state: sub.base_state || '',
      base_zip: sub.base_zip || '',
      base_latitude: sub.base_latitude || null,
      base_longitude: sub.base_longitude || null,
      service_radius_miles: sub.service_radius_miles || 30,
      specialty: sub.specialty || [],
      hourly_rate: sub.hourly_rate?.toString() || '',
      per_sq_rate: sub.per_sq_rate?.toString() || '',
      per_job_rate: sub.per_job_rate?.toString() || '',
      payment_method_preference: sub.payment_method_preference || 'check',
      bank_account: sub.bank_account || '',
      routing_number: sub.routing_number || '',
      tax_id: sub.tax_id || '',
      insurance_verified: sub.insurance_verified || false,
      insurance_expiration: sub.insurance_expiration || '',
      insurance_document_url: sub.insurance_document_url || '',
      license_number: sub.license_number || '',
      is_active: sub.is_active ?? true,
      rating: sub.rating || 0,
      notes: sub.notes || ''
    });
    setShowDialog(true);
  };

  const handleDelete = (sub) => {
    if (window.confirm(`Delete ${sub.name}? This cannot be undone.`)) {
      deleteMutation.mutate(sub.id);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (editingSubcontractor) {
      updateMutation.mutate({ id: editingSubcontractor.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleAddressSelect = async (address) => {
    setFormData(prev => ({
      ...prev,
      base_address: address
    }));

    // Geocode the address to get coordinates and components
    if (window.google && window.google.maps) {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address }, (results, status) => {
        if (status === 'OK' && results[0]) {
          const location = results[0].geometry.location;
          let city = '', state = '', zip = '';
          
          results[0].address_components?.forEach(component => {
            if (component.types.includes('locality')) city = component.long_name;
            if (component.types.includes('administrative_area_level_1')) state = component.short_name;
            if (component.types.includes('postal_code')) zip = component.long_name;
          });

          setFormData(prev => ({
            ...prev,
            base_city: city,
            base_state: state,
            base_zip: zip,
            base_latitude: location.lat(),
            base_longitude: location.lng()
          }));
        }
      });
    }
  };

  const toggleSpecialty = (specialty) => {
    setFormData(prev => ({
      ...prev,
      specialty: prev.specialty.includes(specialty)
        ? prev.specialty.filter(s => s !== specialty)
        : [...prev.specialty, specialty]
    }));
  };

  const filteredSubcontractors = subcontractors.filter(sub => {
    const matchesSearch = !searchTerm || 
      sub.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.contact_person?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.phone?.includes(searchTerm);
    
    const matchesActive = filterActive === 'all' || 
      (filterActive === 'active' && sub.is_active) ||
      (filterActive === 'inactive' && !sub.is_active);
    
    return matchesSearch && matchesActive;
  });

  const specialtyOptions = ['Roofing', 'Siding', 'Windows', 'Doors', 'Gutters', 'HVAC', 'Plumbing', 'Electrical', 'Painting', 'Flooring'];

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t.sidebar.subcontractors}</h1>
          <p className="text-gray-500 mt-1">Manage your network of subcontractors and their service territories</p>
        </div>
        <Button onClick={() => {
          resetForm();
          setEditingSubcontractor(null);
          setShowDialog(true);
        }} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          {t.common.add} {t.sidebar.subcontractors}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">{t.common.total} {t.sidebar.subcontractors}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600">{subcontractors.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">{t.common.active}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{subcontractors.filter(s => s.is_active).length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Avg Service Radius</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-600">
              {subcontractors.length > 0 
                ? Math.round(subcontractors.reduce((sum, s) => sum + (s.service_radius_miles || 30), 0) / subcontractors.length)
                : 30} mi
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total Paid</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">
              ${subcontractors.reduce((sum, s) => sum + Number(s.total_paid || 0), 0).toFixed(2)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex gap-4">
            <Input
              placeholder={t.common.search}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1"
            />
            <Select value={filterActive} onValueChange={setFilterActive}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.common.all}</SelectItem>
                <SelectItem value="active">{t.common.active} Only</SelectItem>
                <SelectItem value="inactive">{t.common.inactive} Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {filteredSubcontractors.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>{t.common.noResults}</p>
              </div>
            ) : (
              filteredSubcontractors.map(sub => (
                <div key={sub.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
                      <Wrench className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-lg">{sub.name}</h4>
                        {sub.is_active ? (
                          <Badge className="bg-green-100 text-green-700">{t.common.active}</Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-700">{t.common.inactive}</Badge>
                        )}
                      </div>
                      {sub.contact_person && (
                        <p className="text-sm text-gray-600">{sub.contact_person}</p>
                      )}
                      <div className="flex flex-wrap gap-3 mt-2 text-sm text-gray-600">
                        {sub.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {sub.phone}
                          </span>
                        )}
                        {(sub.base_address || sub.base_city) && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {sub.base_city ? `${sub.base_city}, ${sub.base_state}` : sub.base_address}
                          </span>
                        )}
                        {sub.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            {sub.email}
                          </span>
                        )}
                        {sub.insurance_expiration && (
                          <span className={`flex items-center gap-1 ${
                            new Date(sub.insurance_expiration) < new Date() ? 'text-red-600' :
                            new Date(sub.insurance_expiration) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) ? 'text-yellow-600' : ''
                          }`}>
                            <Calendar className="w-3 h-3" />
                            Ins. expires: {new Date(sub.insurance_expiration).toLocaleDateString()}
                            {new Date(sub.insurance_expiration) < new Date() && (
                              <AlertTriangle className="w-3 h-3 text-red-600" />
                            )}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {sub.specialty?.map(spec => (
                          <Badge key={spec} variant="outline" className="text-xs">
                            {spec}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-sm text-gray-600">
                        <Navigation className="w-4 h-4" />
                        <span className="font-semibold">{sub.service_radius_miles || 30} mi</span>
                      </div>
                      {sub.rating > 0 && (
                        <div className="flex items-center gap-1 mt-1">
                          <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                          <span className="text-sm font-medium">{sub.rating}/5</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => {
                          setSelectedSubForJobs(sub);
                          setShowJobHistory(true);
                        }}
                        className="text-blue-600"
                      >
                        Jobs
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleEdit(sub)}>
                        <Edit className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleDelete(sub)} className="text-red-600">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={(open) => {
        setShowDialog(open);
        if (!open) {
          setEditingSubcontractor(null);
          resetForm();
        }
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingSubcontractor ? t.common.edit : t.common.add} {t.sidebar.subcontractors}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Company/{t.common.name} *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="ABC Roofing LLC"
                  required
                />
              </div>
              <div>
                <Label>Contact Person</Label>
                <Input
                  value={formData.contact_person}
                  onChange={(e) => setFormData({...formData, contact_person: e.target.value})}
                  placeholder="John Smith"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>{t.common.phone} *</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  placeholder="(555) 123-4567"
                  required
                />
              </div>
              <div>
                <Label>Secondary {t.common.phone}</Label>
                <Input
                  value={formData.phone_2}
                  onChange={(e) => setFormData({...formData, phone_2: e.target.value})}
                  placeholder="(555) 987-6543"
                />
              </div>
            </div>

            <div>
              <Label>{t.common.email}</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                placeholder="contact@abcroofing.com"
              />
            </div>

            <div>
              <Label>Base {t.common.address} (Territory Center) *</Label>
              <GooglePlacesAutocomplete
                apiKey={googleMapsApiKey}
                value={formData.base_address}
                onChange={(e) => setFormData({...formData, base_address: e.target.value})}
                onPlaceSelected={handleAddressSelect}
              />
              <p className="text-xs text-gray-500 mt-1">
                This sets the center of their service territory
              </p>
            </div>

            <div>
              <Label>Service Radius (miles)</Label>
              <Input
                type="number"
                value={formData.service_radius_miles}
                onChange={(e) => setFormData({...formData, service_radius_miles: parseInt(e.target.value) || 30})}
                placeholder="30"
              />
              <p className="text-xs text-gray-500 mt-1">
                How far they're willing to travel from their base address
              </p>
            </div>

            <div>
              <Label>Specialty (Select all that apply)</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {specialtyOptions.map(spec => (
                  <Badge
                    key={spec}
                    onClick={() => toggleSpecialty(spec)}
                    className={`cursor-pointer ${
                      formData.specialty.includes(spec)
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {spec}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Hourly Rate</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.hourly_rate}
                  onChange={(e) => setFormData({...formData, hourly_rate: e.target.value})}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Per SQ Rate</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.per_sq_rate}
                  onChange={(e) => setFormData({...formData, per_sq_rate: e.target.value})}
                  placeholder="0.00"
                />
                <p className="text-xs text-gray-500 mt-1">Per 100 sq ft</p>
              </div>
              <div>
                <Label>Per Job Rate</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.per_job_rate}
                  onChange={(e) => setFormData({...formData, per_job_rate: e.target.value})}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <Label>Payment Method</Label>
              <Select
                value={formData.payment_method_preference}
                onValueChange={(v) => setFormData({...formData, payment_method_preference: v})}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct_deposit">Direct Deposit</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="wire_transfer">Wire Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.payment_method_preference === 'direct_deposit' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Bank Account Number</Label>
                  <Input
                    value={formData.bank_account}
                    onChange={(e) => setFormData({...formData, bank_account: e.target.value})}
                    placeholder="Account number"
                  />
                </div>
                <div>
                  <Label>Routing Number</Label>
                  <Input
                    value={formData.routing_number}
                    onChange={(e) => setFormData({...formData, routing_number: e.target.value})}
                    placeholder="9-digit routing number"
                    maxLength={9}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tax ID (SSN/EIN)</Label>
                <Input
                  value={formData.tax_id}
                  onChange={(e) => setFormData({...formData, tax_id: e.target.value})}
                  placeholder="XX-XXXXXXX"
                />
              </div>
              <div>
                <Label>License Number</Label>
                <Input
                  value={formData.license_number}
                  onChange={(e) => setFormData({...formData, license_number: e.target.value})}
                  placeholder="License #"
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.insurance_verified}
                  onChange={(e) => setFormData({...formData, insurance_verified: e.target.checked})}
                  className="w-4 h-4"
                />
                <Label>Insurance Verified</Label>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Insurance Expiration</Label>
                  <Input
                    type="date"
                    value={formData.insurance_expiration}
                    onChange={(e) => setFormData({...formData, insurance_expiration: e.target.value})}
                  />
                </div>
                <div>
                  <Label>Insurance Certificate (PDF)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          try {
                            const { file_url } = await base44.integrations.Core.UploadFile({ file });
                            setFormData({...formData, insurance_document_url: file_url});
                            toast.success('Insurance document uploaded!');
                          } catch (err) {
                            toast.error('Failed to upload document');
                          }
                        }
                      }}
                      className="flex-1"
                    />
                    {formData.insurance_document_url && (
                      <a 
                        href={formData.insurance_document_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline flex items-center gap-1"
                      >
                        <FileText className="w-4 h-4" />
                        {t.common.view}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <Label>{t.common.notes}</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({...formData, notes: e.target.value})}
                placeholder="Additional notes about this subcontractor..."
                rows={3}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                {t.common.cancel}
              </Button>
              <Button 
                type="submit" 
                disabled={createMutation.isPending || updateMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {createMutation.isPending || updateMutation.isPending ? t.common.loading : editingSubcontractor ? t.common.save : `${t.common.add} ${t.sidebar.subcontractors}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Job History Dialog */}
      <Dialog open={showJobHistory} onOpenChange={setShowJobHistory}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-blue-600" />
              Job History: {selectedSubForJobs?.name}
            </DialogTitle>
          </DialogHeader>

          {selectedSubForJobs && (() => {
            const { tasks, payouts } = getSubcontractorJobs(selectedSubForJobs.id, selectedSubForJobs.email);
            
            return (
              <div className="space-y-6">
                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-gray-600">Tasks Assigned</div>
                      <div className="text-2xl font-bold text-blue-600">{tasks.length}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-gray-600">{t.common.total} Paid</div>
                      <div className="text-2xl font-bold text-green-600">
                        ${Number(selectedSubForJobs.total_paid || 0).toFixed(2)}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-gray-600">Jobs Completed</div>
                      <div className="text-2xl font-bold text-purple-600">
                        {selectedSubForJobs.total_jobs_completed || 0}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Tasks List */}
                <div>
                  <h3 className="font-semibold mb-3">Assigned Tasks ({tasks.length})</h3>
                  {tasks.length === 0 ? (
                    <p className="text-gray-500 text-sm">{t.common.noResults}</p>
                  ) : (
                    <div className="space-y-2">
                      {tasks.map(task => (
                        <Card key={task.id} className="hover:shadow-md transition-shadow">
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <h4 className="font-medium text-sm">{task.name}</h4>
                                {task.related_to && (
                                  <p className="text-xs text-gray-600 mt-1">Customer: {task.related_to}</p>
                                )}
                                <div className="flex items-center gap-2 mt-2">
                                  <Badge variant="outline" className="text-xs">
                                    {task.column?.replace(/_/g, ' ')}
                                  </Badge>
                                  {task.due_date && (
                                    <span className="text-xs text-gray-500">
                                      Due: {new Date(task.due_date).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>

                {/* Payouts List */}
                <div>
                  <h3 className="font-semibold mb-3">Payment History ({payouts.length})</h3>
                  {payouts.length === 0 ? (
                    <p className="text-gray-500 text-sm">{t.common.noResults}</p>
                  ) : (
                    <div className="space-y-2">
                      {payouts.map(payout => (
                        <Card key={payout.id} className="hover:shadow-md transition-shadow">
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="font-medium text-sm">{payout.payout_number}</div>
                                <div className="text-xs text-gray-600 mt-1">
                                  {payout.description || 'No description'}
                                </div>
                                {payout.payment_date && (
                                  <div className="text-xs text-gray-500 mt-1">
                                    Paid: {new Date(payout.payment_date).toLocaleDateString()}
                                  </div>
                                )}
                              </div>
                              <div className="text-right">
                                <div className="font-bold text-green-600">
                                  ${Number(payout.amount || 0).toFixed(2)}
                                </div>
                                <Badge className={
                                  payout.status === 'paid' ? 'bg-green-100 text-green-700' :
                                  payout.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-gray-100 text-gray-700'
                                }>
                                  {payout.status === 'paid' ? t.common.paid : payout.status === 'pending' ? t.common.pending : payout.status}
                                </Badge>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}