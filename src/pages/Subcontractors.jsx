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
  Upload, FileText, AlertTriangle, Calendar, Images
} from 'lucide-react';
import { toast } from 'sonner';
import GooglePlacesAutocomplete from '../components/common/GooglePlacesAutocomplete';
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { parseSubcontractorCsv } from '@/utils/subcontractorCsv';
import SubcontractorRatingDialog, { StarDisplay, RATING_CATEGORIES } from '@/components/subcontractors/SubcontractorRatingDialog';
import SubcontractorRatingHistoryDialog from '@/components/subcontractors/SubcontractorRatingHistoryDialog';
import SubcontractorWorkPhotosDialog from '@/components/subcontractors/SubcontractorWorkPhotosDialog';
import SpecialtyPicker from '@/components/subcontractors/SpecialtyPicker';
import { getSpecialtyOptions } from '@/utils/subcontractorSpecialties';

export default function Subcontractors() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [editingSubcontractor, setEditingSubcontractor] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterActive, setFilterActive] = useState('all');
  const [selectedSubForJobs, setSelectedSubForJobs] = useState(null);
  const [showJobHistory, setShowJobHistory] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const importFileRef = React.useRef(null);
  const [ratingTarget, setRatingTarget] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [photoTarget, setPhotoTarget] = useState(null);
  const [customRates, setCustomRates] = useState({});
  const [hydratedCustomRatesFor, setHydratedCustomRatesFor] = useState(null);

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

  const { company: myCompany, staffProfiles } = useCurrentCompany(user);
  const canManageCustomRates = Boolean(
    user?.platform_role === 'super_admin'
    || myCompany?.created_by === user?.email
    || staffProfiles?.some((profile) => profile.company_id === myCompany?.id
      && (profile.is_administrator || profile.is_super_admin))
  );

  const {
    data: customRateData,
    isLoading: customRatesLoading,
    isError: customRatesError,
    isSuccess: customRatesLoaded,
    refetch: refetchCustomRates,
  } = useQuery({
    queryKey: ['subcontractor-custom-rates', myCompany?.id, editingSubcontractor?.id],
    queryFn: async () => {
      const response = await fetch(`/api/subcontractors/${encodeURIComponent(editingSubcontractor.id)}/rates?company_id=${encodeURIComponent(myCompany.id)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Unable to load custom piece rates.');
      return body;
    },
    enabled: Boolean(myCompany?.id && editingSubcontractor?.id && showDialog),
  });

  useEffect(() => {
    if (!editingSubcontractor || !customRateData?.labor_rates || hydratedCustomRatesFor === editingSubcontractor.id) return;
    setCustomRates(Object.fromEntries(
      customRateData.labor_rates
        .filter((rate) => rate.custom_rate !== null && rate.custom_rate !== undefined)
        .map((rate) => [rate.id, String(rate.custom_rate)])
    ));
    setHydratedCustomRatesFor(editingSubcontractor.id);
  }, [customRateData, editingSubcontractor, hydratedCustomRatesFor]);

  const customRatesReadyForSave = !editingSubcontractor
    || (customRatesLoaded && hydratedCustomRatesFor === editingSubcontractor.id);
  const normalizedOverrides = (overrides) => Object.entries(overrides)
    .filter(([, customRate]) => String(customRate).trim() !== '')
    .map(([laborRateId, customRate]) => [laborRateId, String(customRate).trim()])
    .sort(([a], [b]) => a.localeCompare(b));
  const customRatesChanged = customRatesReadyForSave && editingSubcontractor && (
    JSON.stringify(normalizedOverrides(customRates))
    !== JSON.stringify(normalizedOverrides(Object.fromEntries(
      (customRateData?.labor_rates || [])
        .filter((rate) => rate.custom_rate !== null && rate.custom_rate !== undefined)
        .map((rate) => [rate.id, String(rate.custom_rate)])
    )))
  );

  const { data: subcontractors = [] } = useQuery({
    queryKey: ['subcontractors', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Subcontractor.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const { data: allWorkPhotos = [] } = useQuery({
    queryKey: ['subcontractor-work-photos', myCompany?.id],
    queryFn: () => myCompany?.id
      ? base44.entities.SubcontractorWorkPhoto.filter({ company_id: myCompany.id })
      : [],
    enabled: Boolean(myCompany?.id),
  });
  const workPhotosBySubcontractor = React.useMemo(() => {
    const grouped = {};
    for (const record of allWorkPhotos) {
      const data = record?.data || {};
      const subcontractorId = record?.subcontractor_id ?? data.subcontractor_id;
      const fileUrl = record?.file_url ?? data.file_url;
      if (!subcontractorId || !fileUrl) continue;
      if (!grouped[subcontractorId]) grouped[subcontractorId] = [];
      grouped[subcontractorId].push({
        id: record.id,
        file_url: fileUrl,
        file_name: record?.file_name ?? data.file_name ?? "Work photo",
      });
    }
    return grouped;
  }, [allWorkPhotos]);

  // ── Ratings query + aggregation ──────────────────────────────────────────
  const { data: allRatings = [] } = useQuery({
    queryKey: ['subcontractor-ratings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.SubcontractorRating.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  // Build map: subcontractor_id → { count, avgOverall, avgCleanup, avgOnTime, avgQuality, avgPunchOuts, avgResponseTime }
  const ratingsMap = React.useMemo(() => {
    const map = {};
    for (const r of allRatings) {
      const d = r.data || {};
      if (!d.subcontractor_id) continue;
      if (!map[d.subcontractor_id]) map[d.subcontractor_id] = { count: 0, overall: [], cleanup: [], on_time: [], quality: [], punch_outs: [], response_time: [] };
      const m = map[d.subcontractor_id];
      m.count++;
      if (d.overall)        m.overall.push(d.overall);
      if (d.cleanup)        m.cleanup.push(d.cleanup);
      if (d.on_time)        m.on_time.push(d.on_time);
      if (d.quality)        m.quality.push(d.quality);
      if (d.punch_outs)     m.punch_outs.push(d.punch_outs);
      if (d.response_time)  m.response_time.push(d.response_time);
    }
    const avg = arr => arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0;
    const result = {};
    for (const [id, m] of Object.entries(map)) {
      result[id] = {
        count: m.count,
        overall:       avg(m.overall),
        cleanup:       avg(m.cleanup),
        on_time:       avg(m.on_time),
        quality:       avg(m.quality),
        punch_outs:    avg(m.punch_outs),
        response_time: avg(m.response_time),
      };
    }
    return result;
  }, [allRatings]);

  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Task.filter({ company_id: myCompany.id }, '-created_date', 500) : [],
    enabled: !!myCompany,
  });

  const { data: allPayouts = [] } = useQuery({
    queryKey: ['payouts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payout.filter({ company_id: myCompany.id }, '-created_date', 500) : [],
    enabled: !!myCompany,
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
      });
    },
    onSuccess: (_updated, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['subcontractors'] });
      queryClient.removeQueries({ queryKey: ['subcontractor-custom-rates', myCompany?.id, id], exact: true });
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
      if (customRatesChanged) {
        if (!canManageCustomRates) throw new Error('Only company administrators can change custom piece rates.');
        const overrides = normalizedOverrides(customRates)
          .map(([labor_rate_id, custom_rate]) => ({ labor_rate_id, custom_rate }));
        const response = await fetch(`/api/subcontractors/${encodeURIComponent(id)}/rates?company_id=${encodeURIComponent(myCompany.id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overrides }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Custom piece rates could not be saved. No subcontractor details were changed.');
      }
      return await base44.entities.Subcontractor.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subcontractors'] });
      setShowDialog(false);
      setEditingSubcontractor(null);
      setHydratedCustomRatesFor(null);
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

  const handleImportFile = async (file) => {
    try {
      const parsed = parseSubcontractorCsv(await file.text());
      // Skip rows that already exist (same name, case-insensitive)
      const existing = new Set(subcontractors.map(s => (s.name || '').trim().toLowerCase()));
      const fresh = parsed.filter(r => !existing.has(r.name.trim().toLowerCase()));
      const skipped = parsed.length - fresh.length;
      if (!fresh.length) {
        toast.info('All subcontractors in that CSV are already in your list.');
        return;
      }
      if (skipped > 0) toast.info(`${skipped} row${skipped === 1 ? '' : 's'} skipped — already in your list.`);
      setImportRows(fresh);
      setShowImportDialog(true);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const importMutation = useMutation({
    mutationFn: async (rows) => {
      let created = 0;
      for (const row of rows) {
        await base44.entities.Subcontractor.create({
          company_id: myCompany.id,
          name: row.name,
          contact_person: row.contact_person || '',
          email: row.email || '',
          phone: row.phone || '',
          specialty: row.specialty || [],
          base_city: row.base_city || '',
          base_state: row.base_state || '',
          is_active: true,
        });
        created++;
      }
      return created;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['subcontractors'] });
      setShowImportDialog(false);
      setImportRows([]);
      toast.success(`Imported ${created} subcontractor${created === 1 ? '' : 's'}!`);
    },
    onError: (error) => {
      // Some rows may have been created before the failure — refresh the list either way.
      queryClient.invalidateQueries({ queryKey: ['subcontractors'] });
      toast.error(`Import stopped partway: ${error.message}. Rows imported before the error were kept.`);
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
    // Do not hydrate this editing session from an old override snapshot. A
    // replacement POST is destructive by design, so the modal must start with
    // a fresh server response every time it opens.
    queryClient.removeQueries({ queryKey: ['subcontractor-custom-rates', myCompany?.id, sub.id], exact: true });
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
    setCustomRates({});
    setHydratedCustomRatesFor(null);
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
      if (customRatesChanged && !canManageCustomRates) {
        toast.error('Only company administrators can change custom piece rates.');
        return;
      }
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

  const specialtyOptions = getSpecialtyOptions(subcontractors, formData.specialty);

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t.sidebar.subcontractors}</h1>
          <p className="text-gray-500 mt-1">Manage your network of subcontractors and their service territories</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={importFileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) handleImportFile(f);
            }}
            data-testid="input-import-subs-csv"
          />
          <Button variant="outline" onClick={() => importFileRef.current?.click()} data-testid="button-import-subs-csv">
            <Upload className="w-4 h-4 mr-2" />
            Import CSV
          </Button>
          <Button onClick={() => {
            resetForm();
            setEditingSubcontractor(null);
            setShowDialog(true);
          }} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2" />
            {t.common.add} {t.sidebar.subcontractors}
          </Button>
        </div>
      </div>

      {/* CSV Import review dialog */}
      <Dialog open={showImportDialog} onOpenChange={(open) => { if (!importMutation.isPending) setShowImportDialog(open); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review CSV Import ({importRows.length})</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500 -mt-2">
            Check the rows below before importing. You can fix any field or remove rows you don't want.
          </p>
          <div className="space-y-3">
            {importRows.map((row, idx) => (
              <div key={row._key} className="border rounded-lg p-3 grid grid-cols-2 md:grid-cols-3 gap-2 relative" data-testid={`row-import-sub-${idx}`}>
                <div className="col-span-2 md:col-span-1">
                  <Label className="text-xs">Company / Name *</Label>
                  <Input value={row.name} onChange={(e) => setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, name: e.target.value } : r))} data-testid={`input-import-name-${idx}`} />
                </div>
                <div>
                  <Label className="text-xs">Contact</Label>
                  <Input value={row.contact_person} onChange={(e) => setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, contact_person: e.target.value } : r))} />
                </div>
                <div>
                  <Label className="text-xs">Phone</Label>
                  <Input value={row.phone} onChange={(e) => setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, phone: e.target.value } : r))} />
                </div>
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input value={row.email} onChange={(e) => setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, email: e.target.value } : r))} />
                </div>
                <div>
                  <Label className="text-xs">City</Label>
                  <Input value={row.base_city} onChange={(e) => setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, base_city: e.target.value } : r))} />
                </div>
                <div>
                  <Label className="text-xs">State</Label>
                  <Input value={row.base_state} maxLength={2} onChange={(e) => setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, base_state: e.target.value.toUpperCase() } : r))} />
                </div>
                {row.specialty?.length > 0 && (
                  <div className="col-span-2 md:col-span-3 flex flex-wrap gap-1">
                    {row.specialty.map(s => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}
                  </div>
                )}
                <button
                  type="button"
                  className="absolute top-2 right-2 text-gray-400 hover:text-red-600"
                  onClick={() => setImportRows(prev => prev.filter((_, i) => i !== idx))}
                  title="Remove this row"
                  data-testid={`button-remove-import-row-${idx}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)} disabled={importMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => importMutation.mutate(importRows.filter(r => r.name.trim()))}
              disabled={importMutation.isPending || importRows.filter(r => r.name.trim()).length === 0}
              className="bg-blue-600 hover:bg-blue-700"
              data-testid="button-confirm-import-subs"
            >
              {importMutation.isPending ? 'Importing…' : `Import ${importRows.filter(r => r.name.trim()).length} Subcontractor${importRows.filter(r => r.name.trim()).length === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                <div key={sub.id} className="flex flex-col gap-3 rounded-lg border bg-gray-50 p-3 transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:justify-between sm:p-4">
                  <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center sm:gap-4">
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
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <div className="flex items-center -space-x-1.5" aria-label={`${workPhotosBySubcontractor[sub.id]?.length || 0} work photos`}>
                          {(workPhotosBySubcontractor[sub.id] || []).slice(0, 3).map((photo, index) => (
                            <button
                              type="button"
                              key={photo.id || `${sub.id}-${index}`}
                              onClick={() => setPhotoTarget(sub)}
                              className="h-7 w-7 overflow-hidden rounded border-2 border-gray-50 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                              aria-label={`Open ${photo.file_name}`}
                            >
                              <img src={photo.file_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                            </button>
                          ))}
                          {(workPhotosBySubcontractor[sub.id]?.length || 0) > 3 && (
                            <span className="flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-gray-50 bg-white px-1 text-[10px] font-semibold text-gray-600">
                              +{workPhotosBySubcontractor[sub.id].length - 3}
                            </span>
                          )}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => setPhotoTarget(sub)}
                          aria-label={`Work photos for ${sub.name}`}
                          data-testid={`button-work-photos-${sub.id}`}
                        >
                          <Images className="mr-1.5 h-3.5 w-3.5" />
                          Work photos
                          {(workPhotosBySubcontractor[sub.id]?.length || 0) > 0 && (
                            <span className="ml-1 text-gray-500">({workPhotosBySubcontractor[sub.id].length})</span>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-row flex-wrap items-center justify-between gap-2 sm:min-w-[160px] sm:flex-col sm:items-end sm:justify-start">
                    {/* Rating summary */}
                    {(() => {
                      const r = ratingsMap[sub.id];
                      if (r && r.count > 0) return (
                        <div className="text-right">
                          <div className="flex items-center justify-end gap-1 mb-1">
                            <StarDisplay value={r.overall} size="sm" />
                            <span className="text-sm font-bold text-gray-800">{r.overall.toFixed(1)}</span>
                            <span className="text-xs text-gray-400">({r.count})</span>
                          </div>
                          <div className="space-y-0.5 text-xs text-gray-500">
                            {RATING_CATEGORIES.map(cat => (
                              <div key={cat.key} className="flex items-center justify-between gap-2">
                                <span className="text-right w-20 shrink-0">{cat.label}</span>
                                <div className="flex gap-0.5">
                                  {[1,2,3,4,5].map(n => (
                                    <div key={n} className={`w-2 h-2 rounded-sm ${n <= Math.round(r[cat.key]) ? 'bg-yellow-400' : 'bg-gray-200'}`} />
                                  ))}
                                </div>
                                <span className="w-5 text-right">{r[cat.key].toFixed(1)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                      return (
                        <div className="text-xs text-gray-400 text-right">No ratings yet</div>
                      );
                    })()}
                    <div className="flex gap-1 flex-wrap justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-yellow-600 border-yellow-300 hover:bg-yellow-50"
                        onClick={() => setRatingTarget(sub)}
                      >
                        <Star className="w-3 h-3 mr-1" /> Rate
                      </Button>
                      {ratingsMap[sub.id]?.count > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setHistoryTarget(sub)}
                          data-testid={`button-rating-history-${sub.id}`}
                        >
                          History
                        </Button>
                      )}
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
          setHydratedCustomRatesFor(null);
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
              <SpecialtyPicker
                options={specialtyOptions}
                value={formData.specialty}
                onChange={(specialty) => setFormData((current) => ({ ...current, specialty }))}
              />
            </div>

            {editingSubcontractor && (
              <div className="space-y-3 rounded-lg border bg-slate-50 p-4">
                <div>
                  <Label className="text-base">Custom Piece Rates</Label>
                  <p className="text-xs text-gray-500 mt-1">Leave a price blank to use your standard labor rate when this subcontractor is assigned a work order.</p>
                </div>
                {customRatesLoading && <p className="text-sm text-gray-500">Loading standard tasks…</p>}
                {customRatesError && canManageCustomRates && (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <span>Custom piece rates could not be loaded. Saving is disabled to protect existing prices.</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => refetchCustomRates()}>Retry</Button>
                  </div>
                )}
                {!customRatesLoading && customRateData?.labor_rates?.length === 0 && <p className="text-sm text-gray-500">Add active standard labor rates first, then set custom prices here.</p>}
                <div className="space-y-2">
                  {customRateData?.labor_rates?.map((rate) => (
                    <div key={rate.id} className="grid grid-cols-1 sm:grid-cols-[1fr_150px] gap-2 items-center rounded-md bg-white border p-3">
                      <div><p className="font-medium text-sm">{rate.name}</p><p className="text-xs text-gray-500">Standard: ${(Number(rate.rate_cents) / 100).toFixed(2)} / {rate.unit}</p></div>
                      <div><Label className="text-xs">Custom price / {rate.unit}</Label><Input type="number" min="0" step="0.01" value={customRates[rate.id] || ''} onChange={(e) => setCustomRates((current) => ({ ...current, [rate.id]: e.target.value }))} placeholder="Use standard" disabled={!canManageCustomRates} /></div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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

      {/* Rating dialog */}
      {ratingTarget && (
        <SubcontractorRatingDialog
          open={!!ratingTarget}
          onOpenChange={open => !open && setRatingTarget(null)}
          subcontractor={ratingTarget}
          companyId={myCompany?.id}
          raterName={user?.full_name || user?.email || ''}
        />
      )}

      {/* Rating history dialog */}
      {historyTarget && (
        <SubcontractorRatingHistoryDialog
          open={!!historyTarget}
          onOpenChange={open => !open && setHistoryTarget(null)}
          subcontractor={historyTarget}
          companyId={myCompany?.id}
        />
      )}
      {photoTarget && (
        <SubcontractorWorkPhotosDialog
          open={!!photoTarget}
          onOpenChange={open => !open && setPhotoTarget(null)}
          subcontractor={photoTarget}
          companyId={myCompany?.id}
        />
      )}
    </div>
  );
}