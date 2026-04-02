import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useRoleBasedData } from '@/components/hooks/useRoleBasedData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  CalendarDays,
  Plus,
  Pencil,
  Trash2,
  Search,
  Filter,
  HardHat,
  MapPin,
  User,
  ChevronUp,
  ChevronDown,
  Loader2,
  X,
  ChevronDown as ChevronDownIcon,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

const JOB_TYPES = [
  'Roof Install',
  'Roof Repair',
  'Roof Replacement',
  'Siding',
  'Gutters',
  'Windows',
  'Inspection',
  'Emergency Repair',
  'Other',
];

const BUILD_STATUSES = [
  { value: 'scheduled', label: 'Scheduled', color: 'bg-blue-100 text-blue-700' },
  { value: 'confirmed', label: 'Confirmed', color: 'bg-green-100 text-green-700' },
  { value: 'in_progress', label: 'In Progress', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'postponed', label: 'Postponed', color: 'bg-orange-100 text-orange-700' },
  { value: 'completed', label: 'Completed', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-red-100 text-red-700' },
];

const EMPTY_FORM = {
  customer_name: '',
  customer_id: '',
  address: '',
  rep: '',
  crew: [],
  assigned_to: [],
  job_type: [],
  build_date: '',
  status: 'scheduled',
  insurance_claim_number: '',
  notes: '',
};

export default function BuildSchedule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { myCompany } = useRoleBasedData();
  const companyId = myCompany?.id;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [repFilter, setRepFilter] = useState('all');
  const [crewFilter, setCrewFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortField, setSortField] = useState('build_date');
  const [sortDir, setSortDir] = useState('asc');
  const [deleteId, setDeleteId] = useState(null);
  const [customerSearch, setCustomerSearch] = useState('');

  const { data: builds = [], isLoading } = useQuery({
    queryKey: ['build-schedule', companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const res = await base44.entities.BuildSchedule.filter({ company_id: companyId }, '-build_date', 1000);
      return res;
    },
    enabled: !!companyId,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['/api/local/entity/Customer', companyId, 'for-build-schedule'],
    queryFn: async () => {
      if (!companyId) return [];
      return base44.entities.Customer.filter({ company_id: companyId }, 'name', 1000);
    },
    enabled: !!companyId,
  });

  const { data: allStaff = [] } = useQuery({
    queryKey: ['/api/local/entity/StaffProfile', companyId, 'for-build-schedule'],
    queryFn: async () => {
      if (!companyId) return [];
      return base44.entities.StaffProfile.filter({ company_id: companyId }, 'name', 100);
    },
    enabled: !!companyId,
  });

  const { data: subcontractors = [] } = useQuery({
    queryKey: ['/api/local/entity/Subcontractor', companyId, 'for-build-schedule'],
    queryFn: async () => {
      if (!companyId) return [];
      return base44.entities.Subcontractor.filter({ company_id: companyId }, 'name', 100);
    },
    enabled: !!companyId,
  });

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editingId) {
        return base44.entities.BuildSchedule.update(editingId, data);
      }
      return base44.entities.BuildSchedule.create(data);
    },
    onSuccess: (savedBuild, variables) => {
      queryClient.invalidateQueries({ queryKey: ['build-schedule'] });
      setDialogOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      toast({ title: editingId ? 'Build updated' : 'Build scheduled', description: 'Changes saved successfully.' });
      // Referral fee alert when build is marked completed
      if (variables?.status === 'completed') {
        const relatedCustomer = customers.find(c =>
          (variables.customer_id && c.id === variables.customer_id) ||
          (variables.customer_name && c.name === variables.customer_name)
        );
        if (relatedCustomer?.referral_source) {
          setTimeout(() => {
            toast({
              title: '💰 Referral Fee Owed',
              description: `This job was referred by ${relatedCustomer.referral_source}. Don't forget to pay the referral fee!`,
              variant: 'default',
            });
          }, 600);
        }
      }
    },
    onError: (err) => {
      toast({ title: 'Error', description: err.message || 'Failed to save.', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => base44.entities.BuildSchedule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['build-schedule'] });
      setDeleteId(null);
      toast({ title: 'Build removed', description: 'Entry deleted.' });
    },
  });

  const filteredBuilds = useMemo(() => {
    let list = [...builds];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (b) =>
          (b.customer_name || '').toLowerCase().includes(q) ||
          (b.address || '').toLowerCase().includes(q) ||
          (b.rep || '').toLowerCase().includes(q) ||
          (Array.isArray(b.assigned_to) ? b.assigned_to.join(' ') : (b.assigned_to || '')).toString().toLowerCase().includes(q) ||
          (Array.isArray(b.job_type) ? b.job_type.join(' ') : (b.job_type || '')).toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') {
      list = list.filter((b) => b.status === statusFilter);
    }
    if (repFilter !== 'all') {
      list = list.filter((b) => b.rep === repFilter);
    }
    if (crewFilter !== 'all') {
      list = list.filter((b) => b.assigned_to === crewFilter);
    }
    if (dateFrom) {
      list = list.filter((b) => b.build_date >= dateFrom);
    }
    if (dateTo) {
      list = list.filter((b) => b.build_date <= dateTo);
    }
    list.sort((a, b) => {
      const aRaw = a[sortField];
      const bRaw = b[sortField];
      const aVal = (Array.isArray(aRaw) ? aRaw.join(', ') : aRaw) || '';
      const bVal = (Array.isArray(bRaw) ? bRaw.join(', ') : bRaw) || '';
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [builds, searchQuery, statusFilter, repFilter, crewFilter, dateFrom, dateTo, sortField, sortDir]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return customers.slice(0, 10);
    const q = customerSearch.toLowerCase();
    return customers.filter((c) => (c.name || '').toLowerCase().includes(q)).slice(0, 10);
  }, [customers, customerSearch]);

  function handleSort(field) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setCustomerSearch('');
    setDialogOpen(true);
  }

  function openEdit(build) {
    setEditingId(build.id);
    setForm({
      customer_name: build.customer_name || '',
      customer_id: build.customer_id || '',
      address: build.address || '',
      rep: build.rep || '',
      crew: Array.isArray(build.crew) ? build.crew : (build.crew ? [build.crew] : []),
      assigned_to: Array.isArray(build.assigned_to) ? build.assigned_to : (build.assigned_to ? [build.assigned_to] : []),
      job_type: Array.isArray(build.job_type) ? build.job_type : (build.job_type ? [build.job_type] : []),
      build_date: build.build_date || '',
      status: build.status || 'scheduled',
      insurance_claim_number: build.insurance_claim_number || '',
      notes: build.notes || '',
    });
    setCustomerSearch('');
    setDialogOpen(true);
  }

  function handleSelectCustomer(customer) {
    const addr = [customer.street, customer.city, customer.state, customer.zip]
      .filter(Boolean)
      .join(', ') || customer.address || '';
    
    // Auto-populate crew and assigned_to from customer data if available
    const crewList = customer.data?.crew ? (Array.isArray(customer.data.crew) ? customer.data.crew : [customer.data.crew]) : [];
    const assignedList = customer.data?.assigned_to ? (Array.isArray(customer.data.assigned_to) ? customer.data.assigned_to : [customer.data.assigned_to]) : [];
    
    setForm((f) => ({
      ...f,
      customer_name: customer.name || '',
      customer_id: customer.id || '',
      address: addr,
      insurance_claim_number: customer.data?.claim_number || customer.insurance_company || customer.data?.insurance_claim_number || f.insurance_claim_number,
      crew: crewList.length > 0 ? crewList : f.crew,
      assigned_to: assignedList.length > 0 ? assignedList : f.assigned_to,
    }));
    setCustomerSearch('');
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.customer_name || !form.build_date) {
      toast({ title: 'Missing fields', description: 'Customer name and build date are required.', variant: 'destructive' });
      return;
    }
    if (form.job_type.length === 0) {
      toast({ title: 'Missing job type', description: 'Please select at least one job type.', variant: 'destructive' });
      return;
    }
    saveMutation.mutate({ ...form, company_id: companyId });
  }

  const statusObj = (s) => BUILD_STATUSES.find((st) => st.value === s) || BUILD_STATUSES[0];

  function SortIcon({ field }) {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 inline ml-1" /> : <ChevronDown className="w-3 h-3 inline ml-1" />;
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const stats = useMemo(() => {
    const today = builds.filter((b) => b.build_date === todayStr).length;
    const thisWeek = builds.filter((b) => b.build_date >= todayStr && b.build_date <= weekFromNow).length;
    const inProgress = builds.filter((b) => b.status === 'in_progress').length;
    const scheduled = builds.filter((b) => b.status === 'scheduled' || b.status === 'confirmed').length;
    return { today, thisWeek, inProgress, scheduled };
  }, [builds, todayStr, weekFromNow]);

  if (!companyId) {
    return (
      <div className="p-6 text-center text-gray-500">Loading company info...</div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="heading-build-schedule">
            <HardHat className="w-6 h-6 text-blue-600" />
            Build Schedule
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage upcoming installations and repairs</p>
        </div>
        <Button onClick={openAdd} className="bg-blue-600 hover:bg-blue-700" data-testid="button-add-build">
          <Plus className="w-4 h-4 mr-2" />
          Add Build
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-gray-500">Today</div>
            <div className="text-xl font-bold text-blue-600" data-testid="stat-today">{stats.today}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-gray-500">This Week</div>
            <div className="text-xl font-bold text-green-600" data-testid="stat-this-week">{stats.thisWeek}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-gray-500">In Progress</div>
            <div className="text-xl font-bold text-yellow-600" data-testid="stat-in-progress">{stats.inProgress}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-gray-500">Scheduled</div>
            <div className="text-xl font-bold text-purple-600" data-testid="stat-scheduled">{stats.scheduled}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search by customer, address, rep, crew..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-builds"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {BUILD_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-gray-500 whitespace-nowrap">Date Range:</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[150px]"
              placeholder="From"
              data-testid="input-date-from"
            />
            <span className="text-gray-400 text-xs">to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[150px]"
              placeholder="To"
              data-testid="input-date-to"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDateFrom(todayStr);
                setDateTo(weekFromNow);
              }}
              data-testid="button-this-week"
            >
              This Week
            </Button>
          </div>
          <Select value={repFilter} onValueChange={setRepFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-rep-filter">
              <SelectValue placeholder="All Reps" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Reps</SelectItem>
              {allStaff.map((s) => (
                <SelectItem key={s.id} value={s.name || s.full_name || s.email}>{s.name || s.full_name || s.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={crewFilter} onValueChange={setCrewFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-crew-filter">
              <SelectValue placeholder="All Crews" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Crews</SelectItem>
              {subcontractors.map((s) => (
                <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(dateFrom || dateTo || repFilter !== 'all' || crewFilter !== 'all' || statusFilter !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setDateFrom(''); setDateTo(''); setRepFilter('all'); setCrewFilter('all'); setStatusFilter('all'); }}
              className="text-xs"
              data-testid="button-clear-filters"
            >
              <X className="w-3 h-3 mr-1" /> Clear Filters
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : filteredBuilds.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <HardHat className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No builds found</p>
              <p className="text-sm mt-1">Add your first build to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('build_date')} data-testid="sort-date">
                      Date <SortIcon field="build_date" />
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('customer_name')} data-testid="sort-customer">
                      Customer <SortIcon field="customer_name" />
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('job_type')} data-testid="sort-type">
                      Type <SortIcon field="job_type" />
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('rep')} data-testid="sort-rep">
                      Rep <SortIcon field="rep" />
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('assigned_to')} data-testid="sort-assigned">
                      Assigned <SortIcon field="assigned_to" />
                    </TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('status')} data-testid="sort-status">
                      Status <SortIcon field="status" />
                    </TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBuilds.map((build) => {
                    const st = statusObj(build.status);
                    const isToday = build.build_date === todayStr;
                    const isPast = build.build_date < todayStr && build.status !== 'completed' && build.status !== 'cancelled';
                    return (
                      <TableRow
                        key={build.id}
                        className={`${isToday ? 'bg-blue-50' : ''} ${isPast ? 'bg-red-50' : ''}`}
                        data-testid={`row-build-${build.id}`}
                      >
                        <TableCell className="font-medium whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <CalendarDays className="w-3.5 h-3.5 text-gray-400" />
                            {build.build_date ? new Date(build.build_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                          </div>
                          {isToday && <Badge className="text-[10px] bg-blue-600 mt-0.5">TODAY</Badge>}
                          {isPast && <Badge className="text-[10px] bg-red-600 mt-0.5">OVERDUE</Badge>}
                        </TableCell>
                        <TableCell className="font-medium">{build.customer_name || '—'}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {Array.isArray(build.job_type) && build.job_type.length > 0 ? (
                              build.job_type.map((jt) => (
                                <Badge key={jt} variant="outline" className="text-xs">{jt}</Badge>
                              ))
                            ) : !Array.isArray(build.job_type) && build.job_type ? (
                              <Badge variant="outline" className="text-xs">{build.job_type}</Badge>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3 text-gray-400" />
                            <span className="text-sm">{build.rep || '—'}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {Array.isArray(build.assigned_to) && build.assigned_to.length > 0 ? (
                              build.assigned_to.map((a) => (
                                <div key={a} className="flex items-center gap-1 text-xs bg-gray-100 px-2 py-1 rounded">
                                  <HardHat className="w-3 h-3 text-gray-400" />
                                  <span>{a}</span>
                                </div>
                              ))
                            ) : !Array.isArray(build.assigned_to) && build.assigned_to ? (
                              <div className="flex items-center gap-1 text-xs bg-gray-100 px-2 py-1 rounded">
                                <HardHat className="w-3 h-3 text-gray-400" />
                                <span>{build.assigned_to}</span>
                              </div>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm text-gray-600">
                          {build.address ? (
                            <div className="flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
                              <span className="truncate">{build.address}</span>
                            </div>
                          ) : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-xs ${st.color}`}>{st.label}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(build)} data-testid={`button-edit-build-${build.id}`}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-700" onClick={() => setDeleteId(build.id)} data-testid={`button-delete-build-${build.id}`}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Build' : 'Schedule New Build'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div>
              <Label>Customer *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between text-left"
                    data-testid="button-customer-dropdown"
                  >
                    <span>{form.customer_name || 'Select customer...'}</span>
                    <ChevronDownIcon className="w-4 h-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <div className="p-2 space-y-1 max-h-64 overflow-y-auto">
                    <div className="sticky top-0 bg-white p-2 border-b mb-1">
                      <Input
                        placeholder="Search customers..."
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        className="h-8 text-sm"
                        data-testid="input-customer-search"
                      />
                    </div>
                    {filteredCustomers.length === 0 ? (
                      <p className="text-xs text-gray-500 py-2 px-2">No customers found</p>
                    ) : (
                      filteredCustomers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full px-2 py-2 text-left text-sm hover:bg-gray-100 rounded flex flex-col"
                          onClick={() => handleSelectCustomer(c)}
                          data-testid={`option-customer-${c.id}`}
                        >
                          <span className="font-medium">{c.name}</span>
                          <span className="text-gray-400 text-xs truncate">{c.address || c.street || c.city || ''}</span>
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label>Address</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Job site address"
                data-testid="input-address"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Sales Rep</Label>
                <Select value={form.rep} onValueChange={(v) => setForm((f) => ({ ...f, rep: v }))}>
                  <SelectTrigger data-testid="select-rep">
                    <SelectValue placeholder="Select rep" />
                  </SelectTrigger>
                  <SelectContent>
                    {allStaff.map((s) => (
                      <SelectItem key={s.id} value={s.name || s.full_name || s.email}>
                        {s.name || s.full_name || s.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Crew (Multiple)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between text-left h-9"
                      data-testid="button-crew-dropdown"
                    >
                      <span className="text-sm">{form.crew.length === 0 ? 'Select crew...' : `${form.crew.length} selected`}</span>
                      <ChevronDownIcon className="w-4 h-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {subcontractors.length === 0 ? (
                        <p className="text-xs text-gray-500 py-2">No subcontractors available</p>
                      ) : (
                        subcontractors.map((s) => {
                          const isSelected = form.crew.includes(s.name);
                          return (
                            <label key={s.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setForm((f) => ({ ...f, crew: [...f.crew, s.name] }));
                                  } else {
                                    setForm((f) => ({ ...f, crew: f.crew.filter((c) => c !== s.name) }));
                                  }
                                }}
                                className="w-4 h-4"
                                data-testid={`checkbox-crew-${s.id}`}
                              />
                              <span className="text-sm">{s.name}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {form.crew.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {form.crew.map((c) => (
                      <Badge
                        key={c}
                        variant="outline"
                        className="text-xs cursor-pointer hover:bg-red-50"
                        onClick={() => setForm((f) => ({ ...f, crew: f.crew.filter((item) => item !== c) }))}
                      >
                        {c} <X className="w-3 h-3 ml-1" />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Label>Assigned To (Multiple)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between text-left h-9"
                      data-testid="button-assigned-dropdown"
                    >
                      <span className="text-sm">{form.assigned_to.length === 0 ? 'Select assigned...' : `${form.assigned_to.length} selected`}</span>
                      <ChevronDownIcon className="w-4 h-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {allStaff.length === 0 ? (
                        <p className="text-xs text-gray-500 py-2">No staff available</p>
                      ) : (
                        allStaff.map((s) => {
                          const staffName = s.name || s.full_name || s.email;
                          const isSelected = form.assigned_to.includes(staffName);
                          return (
                            <label key={s.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setForm((f) => ({ ...f, assigned_to: [...f.assigned_to, staffName] }));
                                  } else {
                                    setForm((f) => ({ ...f, assigned_to: f.assigned_to.filter((a) => a !== staffName) }));
                                  }
                                }}
                                className="w-4 h-4"
                                data-testid={`checkbox-assigned-${s.id}`}
                              />
                              <span className="text-sm">{staffName}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {form.assigned_to.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {form.assigned_to.map((a) => (
                      <Badge
                        key={a}
                        variant="outline"
                        className="text-xs cursor-pointer hover:bg-red-50"
                        onClick={() => setForm((f) => ({ ...f, assigned_to: f.assigned_to.filter((item) => item !== a) }))}
                      >
                        {a} <X className="w-3 h-3 ml-1" />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label>Job Type (Multiple) *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between text-left"
                    data-testid="button-job-type-dropdown"
                  >
                    <span className="text-sm">{form.job_type.length === 0 ? 'Select job types...' : `${form.job_type.length} selected`}</span>
                    <ChevronDownIcon className="w-4 h-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {JOB_TYPES.map((t) => {
                      const isSelected = form.job_type.includes(t);
                      return (
                        <label key={t} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setForm((f) => ({ ...f, job_type: [...f.job_type, t] }));
                              } else {
                                setForm((f) => ({ ...f, job_type: f.job_type.filter((jt) => jt !== t) }));
                              }
                            }}
                            className="w-4 h-4"
                            data-testid={`checkbox-job-type-${t}`}
                          />
                          <span className="text-sm">{t}</span>
                        </label>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              {form.job_type.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {form.job_type.map((t) => (
                    <Badge
                      key={t}
                      variant="outline"
                      className="text-xs cursor-pointer hover:bg-red-50"
                      onClick={() => setForm((f) => ({ ...f, job_type: f.job_type.filter((item) => item !== t) }))}
                    >
                      {t} <X className="w-3 h-3 ml-1" />
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label>Build Date *</Label>
              <Input
                type="date"
                value={form.build_date}
                onChange={(e) => setForm((f) => ({ ...f, build_date: e.target.value }))}
                data-testid="input-build-date"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger data-testid="select-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUILD_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Insurance Claim #</Label>
                <Input
                  value={form.insurance_claim_number}
                  onChange={(e) => setForm((f) => ({ ...f, insurance_claim_number: e.target.value }))}
                  placeholder="Optional"
                  data-testid="input-insurance-claim"
                />
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Special instructions, materials needed..."
                rows={3}
                data-testid="input-notes"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700" disabled={saveMutation.isPending} data-testid="button-save-build">
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {editingId ? 'Update Build' : 'Schedule Build'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-build">
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Build Entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this scheduled build. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate(deleteId)}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
