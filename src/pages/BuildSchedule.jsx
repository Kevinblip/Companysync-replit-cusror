import { useState, useMemo, useEffect } from 'react';
import { getTranslations, getStoredLanguage } from '@/utils/translations';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useRoleBasedData } from '@/components/hooks/useRoleBasedData';
import { usePageGuard } from '@/hooks/usePageGuard';
import {
  SCOPE_CATEGORY_LABELS,
  PUNCH_CATEGORY,
  estimateItemsToScopeItems,
  templateItemsForJobTypes,
  mergeScopeItems,
  toggleScopeItem,
  scopeProgress,
  punchProgress,
  isPunchItem,
  buildScopeItems,
  makeScopeItem,
} from '@/lib/scopeOfWork';
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
  ListChecks,
  ClipboardList,
  StickyNote,
  CheckCircle2,
  Circle,
  Camera,
  Sparkles,
  AlertTriangle,
  Share2,
} from 'lucide-react';
import { toast } from 'sonner';
import { localToday } from "@/utils/localDate";
import { trackEvent } from "@/utils/analytics";

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
  customer_phone: '',
  customer_email: '',
  rep: '',
  crew: [],
  assigned_to: [],
  job_type: [],
  build_date: '',
  status: 'scheduled',
  waiting_reason: '',
  insurance_claim_number: '',
  notes: '',
  send_customer_reminders: false,
  scope_of_work: [],
  scope_estimate_id: '',
  scope_generated_at: '',
};

export default function BuildSchedule() {
  usePageGuard({ feature: 'projects' });
  const queryClient = useQueryClient();
  const t = getTranslations(getStoredLanguage()).schedule;
  const { myCompany, user, isAdmin, myStaffProfile, isDataLoading: isRoleLoading, filterCustomers } = useRoleBasedData();
  const companyId = myCompany?.id;
  // Resolved identity for server-side scoping (prefer profile name so it matches the rep field)
  const myStaffName = myStaffProfile?.name || myStaffProfile?.full_name || user?.email;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [repFilter, setRepFilter] = useState('all');
  const [crewFilter, setCrewFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortField, setSortField] = useState('build_date');
  const [sortDir, setSortDir] = useState('desc');
  const [deleteId, setDeleteId] = useState(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedEstimateId, setSelectedEstimateId] = useState('');
  const [newItemLabel, setNewItemLabel] = useState('');
  const [newPunchLabel, setNewPunchLabel] = useState('');
  const [noteEditingId, setNoteEditingId] = useState(null);
  const [uploadingItemId, setUploadingItemId] = useState(null);
  const [scopeWarnOpen, setScopeWarnOpen] = useState(false);
  const [pendingMissing, setPendingMissing] = useState([]);
  const [checkAllConfirmOpen, setCheckAllConfirmOpen] = useState(false);
  const [sendingCrewLink, setSendingCrewLink] = useState(null); // build.id while sending

  // Auto-open dialog when navigated from a customer profile:
  //   ?customerId=...&customerName=...&address=... → new build pre-filled
  //   ?editId=...                                  → edit existing build
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefillCustomerId = params.get('customerId');
    const prefillCustomerName = params.get('customerName');
    const prefillAddress = params.get('address');
    if (prefillCustomerId || prefillCustomerName) {
      setForm({
        ...EMPTY_FORM,
        customer_id: prefillCustomerId || '',
        customer_name: prefillCustomerName || '',
        address: prefillAddress || '',
      });
      setEditingId(null);
      setDialogOpen(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const { data: builds = [], isLoading } = useQuery({
    queryKey: ['build-schedule', companyId, isAdmin ? 'admin' : myStaffName],
    queryFn: async () => {
      if (!companyId) return [];
      if (isAdmin) {
        return base44.entities.BuildSchedule.filter({ company_id: companyId }, '-build_date', 1000);
      }
      if (!myStaffName) return [];
      // Non-admins: scope server-side to builds where they are the rep, creator,
      // or assigned crew. Lexi writes durable email assignment in addition to
      // display-name fields used by older UI records.
      // Two parallel queries because the entity API has no $or operator.
      const [repBuilds, repEmailBuilds, creatorBuilds, crewBuilds, emailCrewBuilds] = await Promise.all([
        base44.entities.BuildSchedule.filter({ company_id: companyId, rep: myStaffName }, '-build_date', 1000),
        base44.entities.BuildSchedule.filter({ company_id: companyId, rep_email: user?.email }, '-build_date', 1000),
        base44.entities.BuildSchedule.filter({ company_id: companyId, created_by: user?.email }, '-build_date', 1000),
        base44.entities.BuildSchedule.filter({ company_id: companyId, assigned_to: { $contains: myStaffName } }, '-build_date', 1000),
        base44.entities.BuildSchedule.filter({ company_id: companyId, assigned_to_users: { $contains: user?.email } }, '-build_date', 1000),
      ]);
      // Merge, deduplicate by ID
      const seen = new Set();
      return [...repBuilds, ...repEmailBuilds, ...creatorBuilds, ...crewBuilds, ...emailCrewBuilds].filter((b) => {
        if (seen.has(b.id)) return false;
        seen.add(b.id);
        return true;
      });
    },
    // Wait for role to resolve before firing so isAdmin is authoritative
    enabled: !!companyId && !isRoleLoading,
  });

  // Open edit dialog for a specific build once builds have loaded
  useEffect(() => {
    if (!builds.length) return;
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('editId');
    if (editId) {
      const build = builds.find((b) => b.id === editId);
      if (build) {
        openEdit(build);
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, [builds]);

  const { data: customers = [] } = useQuery({
    queryKey: ['/api/local/entity/Customer', companyId, isAdmin ? 'admin' : user?.email, 'for-build-schedule'],
    queryFn: async () => {
      if (!companyId || !user?.email) return [];
      // Non-admins: scope server-side so other reps' customers never reach the client
      const filter = isAdmin
        ? { company_id: companyId }
        : { company_id: companyId, assigned_to: user.email };
      return base44.entities.Customer.filter(filter, 'name', 1000);
    },
    enabled: !!companyId && !isRoleLoading && !!user?.email,
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

  // Estimates for the customer currently selected in the dialog — used to build
  // the scope-of-work checklist from real line items.
  const { data: customerEstimates = [] } = useQuery({
    queryKey: ['estimates-for-build', companyId, form.customer_id],
    queryFn: async () => {
      if (!companyId || !form.customer_id) return [];
      return base44.entities.Estimate.filter({ company_id: companyId, customer_id: form.customer_id });
    },
    enabled: !!companyId && !!form.customer_id && dialogOpen,
  });

  // Company-level standard-step overrides (falls back to built-in defaults).
  const { data: scopeTemplates = [] } = useQuery({
    queryKey: ['scope-templates', companyId],
    queryFn: async () => {
      if (!companyId) return [];
      return base44.entities.ScopeTemplate.filter({ company_id: companyId });
    },
    enabled: !!companyId,
  });

  const customTemplateMap = useMemo(() => {
    const m = {};
    for (const tpl of scopeTemplates) {
      if (tpl.job_type && Array.isArray(tpl.items)) m[tpl.job_type] = tpl.items;
    }
    return m;
  }, [scopeTemplates]);

  const estimatesWithItems = useMemo(
    () =>
      (customerEstimates || [])
        .filter((e) => Array.isArray(e.items) && e.items.length > 0)
        .sort(
          (a, b) =>
            new Date(b.created_at || b.created_date || 0) -
            new Date(a.created_at || a.created_date || 0),
        ),
    [customerEstimates],
  );

  // Deterministic "best" estimate: prefer accepted/approved, then sent, then
  // drafts; break ties by most recent.
  const recommendedEstimate = useMemo(() => {
    const rank = { accepted: 0, approved: 0, sent: 1, draft: 2 };
    const sorted = [...estimatesWithItems].sort((a, b) => {
      const ra = rank[(a.status || '').toLowerCase()] ?? 3;
      const rb = rank[(b.status || '').toLowerCase()] ?? 3;
      if (ra !== rb) return ra - rb;
      return (
        new Date(b.created_at || b.created_date || 0) -
        new Date(a.created_at || a.created_date || 0)
      );
    });
    return sorted[0] || null;
  }, [estimatesWithItems]);

  const activeEstimate = useMemo(
    () =>
      estimatesWithItems.find((e) => e.id === selectedEstimateId) || recommendedEstimate,
    [estimatesWithItems, selectedEstimateId, recommendedEstimate],
  );

  // Default the estimate picker to the saved one (edit) or the recommendation.
  useEffect(() => {
    if (!dialogOpen || selectedEstimateId) return;
    if (form.scope_estimate_id && estimatesWithItems.some((e) => e.id === form.scope_estimate_id)) {
      setSelectedEstimateId(form.scope_estimate_id);
    } else if (recommendedEstimate) {
      setSelectedEstimateId(recommendedEstimate.id);
    }
  }, [dialogOpen, estimatesWithItems, recommendedEstimate, form.scope_estimate_id, selectedEstimateId]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const payload = editingId
        ? data
        : {
            ...data,
            created_by: data.created_by || user?.email || 'system',
            created_by_name: data.created_by_name || myStaffProfile?.full_name || user?.full_name || user?.email || 'System',
          };
      if (editingId) {
        return base44.entities.BuildSchedule.update(editingId, payload);
      }
      return base44.entities.BuildSchedule.create(payload);
    },
    onSuccess: async (savedBuild, variables) => {
      queryClient.invalidateQueries({ queryKey: ['build-schedule'] });
      setDialogOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      toast.success(editingId ? 'Build updated' : 'Build scheduled', { description: 'Changes saved successfully.' });
      trackEvent(editingId ? 'build_updated' : 'build_scheduled', {
        source: 'build_schedule',
        job_type_count: Array.isArray(variables.job_type) ? variables.job_type.length : 0,
        has_assignee: Boolean(
          Array.isArray(variables.assigned_to)
            ? variables.assigned_to.length
            : variables.assigned_to
        ),
        calendar_sync_requested: Boolean(variables.build_date),
      });

      // Auto-create (or update) a CalendarEvent so the build appears on the calendar
      try {
        const dateStr = variables.build_date;
        if (dateStr && companyId) {
          const startDate = new Date(dateStr + 'T07:00:00');
          const endDate = new Date(dateStr + 'T17:00:00');

          // Resolve assigned email: look up first assigned name in allStaff
          const assignedNames = Array.isArray(variables.assigned_to) ? variables.assigned_to : (variables.assigned_to ? [variables.assigned_to] : []);
          const assignedStaff = assignedNames.map(name => allStaff.find(s => (s.name || s.full_name) === name)).filter(Boolean);
          const primaryEmail = assignedStaff[0]?.user_email || assignedStaff[0]?.email || user?.email;

          const jobLabel = Array.isArray(variables.job_type) && variables.job_type.length > 0
            ? variables.job_type.join(' & ') : 'Build';

          const calPayload = {
            company_id: companyId,
            title: `${jobLabel}: ${variables.customer_name || 'Customer'}`,
            description: `📍 ${variables.address || ''}\n👤 ${variables.customer_name || ''}\n📞 ${variables.customer_phone || ''}\n🏷️ ${jobLabel}${variables.notes ? '\n📝 ' + variables.notes : ''}`,
            start_time: startDate.toISOString(),
            end_time: endDate.toISOString(),
            event_type: 'build',
            location: variables.address || '',
            assigned_to: primaryEmail,
            attendees: assignedStaff.map(s => s.user_email || s.email).filter(Boolean),
            related_customer: variables.customer_name || '',
            customer_name: variables.customer_name || '',
            customer_phone: variables.customer_phone || '',
            customer_email: variables.customer_email || '',
            send_customer_reminders: variables.send_customer_reminders || false,
            status: 'scheduled',
            color: '#f59e0b',
          };

          if (editingId && savedBuild?.calendar_event_id) {
            // Update existing calendar event
            await base44.entities.CalendarEvent.update(savedBuild.calendar_event_id, calPayload);
          } else if (!editingId) {
            // Create new calendar event and link it back to the build
            const calEvent = await base44.entities.CalendarEvent.create(calPayload);
            await base44.entities.BuildSchedule.update(savedBuild.id, { calendar_event_id: calEvent.id });
          }
        }
      } catch (calErr) {
        console.warn('[BuildSchedule] Auto-calendar failed:', calErr?.message);
      }

      // Create CustomerNote entity for the unified feed whenever a build has notes
      if (variables?.notes) {
        const relatedCustomer = customers.find(c =>
          (variables.customer_id && c.id === variables.customer_id) ||
          (variables.customer_name && c.name === variables.customer_name)
        );
        const jobLabel = Array.isArray(variables.job_type) && variables.job_type.length > 0
          ? variables.job_type.join(', ')
          : 'Build';
        const dateLabel = variables.build_date
          ? new Date(variables.build_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '';
        const actionPrefix = editingId ? 'Build Updated' : 'Schedule Build';
        const buildNoteText = `[${actionPrefix}${dateLabel ? ' – ' + dateLabel : ''}${jobLabel ? ' – ' + jobLabel : ''}]: ${variables.notes}`;

        try {
          await base44.entities.CustomerNote.create({
            company_id: companyId,
            customer_id: relatedCustomer?.id || variables.customer_id || null,
            note: buildNoteText,
            source_type: 'build_schedule',
            source_id: savedBuild?.id || null,
            source_label: `Build: ${jobLabel}${dateLabel ? ' – ' + dateLabel : ''}`,
            created_by: user?.email || 'system',
            created_by_name: user?.full_name || user?.email || 'system',
            created_at: new Date().toISOString(),
          });
          if (relatedCustomer?.id) {
            queryClient.invalidateQueries({ queryKey: ['customer-notes', relatedCustomer.id] });
          }
        } catch (e) {
          console.warn('[BuildSchedule] Could not create CustomerNote entity:', e.message);
        }
      }

      // Keep the open-punch-list reminder in step with the checklist that was
      // just saved: adding the first punch item opens the nag, checking off the
      // last one closes it. The hourly cron does the same sweep, so a failure
      // here only delays it — never blocks the save.
      const savedBuildId = editingId || savedBuild?.id;
      if (savedBuildId && (Array.isArray(variables?.scope_of_work) || editingId)) {
        try {
          await base44.functions.invoke('syncPunchListNag', { buildId: savedBuildId });
        } catch (punchErr) {
          console.warn('[BuildSchedule] Punch list reminder sync failed:', punchErr?.message);
        }
      }

      // Referral fee alert when build is marked completed
      if (variables?.status === 'completed') {
        const relatedCustomer = customers.find(c =>
          (variables.customer_id && c.id === variables.customer_id) ||
          (variables.customer_name && c.name === variables.customer_name)
        );
        if (relatedCustomer?.referral_source) {
          setTimeout(() => {
            toast('💰 Referral Fee Owed', {
              description: `This job was referred by ${relatedCustomer.referral_source}. Don't forget to pay the referral fee!`,
            });
          }, 600);
        }
      }
    },
    onError: (err) => {
      toast.error(t.error || 'Error', { description: err.message || t.failedToSave });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      if (!isAdmin && user?.email) {
        const build = builds.find((b) => b.id === id);
        const myName = myStaffProfile?.name || myStaffProfile?.full_name || user.email;
        const crew = Array.isArray(build?.assigned_to)
          ? build.assigned_to
          : build?.assigned_to ? [build.assigned_to] : [];
        const isOwned =
          build?.rep === myName ||
          build?.rep === user.email ||
          crew.some((a) => a === myName || a === user.email);
        if (!isOwned) throw new Error("Not authorized to delete this build entry");
      }
      return base44.entities.BuildSchedule.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['build-schedule'] });
      setDeleteId(null);
      toast.success('Build removed', { description: 'Entry deleted.' });
    },
  });

  const filteredBuilds = useMemo(() => {
    let list = [...builds];

    // Fail closed: show nothing until auth resolves.
    if (!user?.email) return [];
    // Non-admin staff see only builds where they are the sales rep or an assigned crew member.
    if (!isAdmin) {
      const myName = myStaffProfile?.name || myStaffProfile?.full_name || user.email;
      list = list.filter((b) => {
        if (b.rep && (b.rep === myName || b.rep === user.email)) return true;
        const crew = Array.isArray(b.assigned_to)
          ? b.assigned_to
          : b.assigned_to ? [b.assigned_to] : [];
        return crew.some((a) => a === myName || a === user.email);
      });
    }

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
    if (statusFilter === 'active') {
      list = list.filter((b) => b.status !== 'completed' && b.status !== 'cancelled');
    } else if (statusFilter !== 'all') {
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
  }, [builds, searchQuery, statusFilter, repFilter, crewFilter, dateFrom, dateTo, sortField, sortDir, isAdmin, user?.email, myStaffProfile]);

  const filteredCustomers = useMemo(() => {
    // Apply role-based filter as a client-side second layer (catches assigned_to_users too)
    const scopedCustomers = isAdmin ? customers : filterCustomers(customers);
    if (!customerSearch) return scopedCustomers.slice(0, 10);
    const q = customerSearch.toLowerCase();
    return scopedCustomers.filter((c) => (c.name || '').toLowerCase().includes(q)).slice(0, 10);
  }, [customers, customerSearch, isAdmin, filterCustomers]);

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
    setSelectedEstimateId('');
    setNewItemLabel('');
    setDialogOpen(true);
  }

  function openEdit(build) {
    setEditingId(build.id);
    setForm({
      customer_name: build.customer_name || '',
      customer_id: build.customer_id || '',
      address: build.address || '',
      customer_phone: build.customer_phone || '',
      customer_email: build.customer_email || '',
      rep: build.rep || '',
      crew: Array.isArray(build.crew) ? build.crew : (build.crew ? [build.crew] : []),
      assigned_to: Array.isArray(build.assigned_to) ? build.assigned_to : (build.assigned_to ? [build.assigned_to] : []),
      job_type: Array.isArray(build.job_type) ? build.job_type : (build.job_type ? [build.job_type] : []),
      build_date: build.build_date || '',
      status: build.status || 'scheduled',
      waiting_reason: build.waiting_reason || '',
      insurance_claim_number: build.insurance_claim_number || '',
      notes: build.notes || '',
      send_customer_reminders: build.send_customer_reminders || false,
      scope_of_work: Array.isArray(build.scope_of_work) ? build.scope_of_work : [],
      scope_estimate_id: build.scope_estimate_id || '',
      scope_generated_at: build.scope_generated_at || '',
    });
    setCustomerSearch('');
    setSelectedEstimateId(build.scope_estimate_id || '');
    setNewItemLabel('');
    setDialogOpen(true);
  }

  function handleSelectCustomer(customer) {
    const addr = [customer.street, customer.city, customer.state, customer.zip]
      .filter(Boolean)
      .join(', ') || customer.address || customer.property_address || '';

    // Auto-fill Sales Rep from customer's assigned_to email → staff name
    const repEmails = customer.assigned_to_users?.length
      ? customer.assigned_to_users
      : customer.assigned_to ? [customer.assigned_to] : [];
    const matchedRep = allStaff.find(s =>
      repEmails.includes(s.user_email) || repEmails.includes(s.email)
    );
    const autoRep = matchedRep ? (matchedRep.name || matchedRep.full_name || matchedRep.user_email) : '';

    // Auto-fill Assigned To from all assigned users → staff names
    const autoAssigned = repEmails
      .map(email => {
        const s = allStaff.find(st => st.user_email === email || st.email === email);
        return s ? (s.name || s.full_name || s.user_email) : null;
      })
      .filter(Boolean);

    // Auto-fill Crew from customer's installer field (could be a name or email)
    let autoCrew = [];
    if (customer.installer) {
      const byName = subcontractors.find(s => s.name === customer.installer);
      const byEmail = subcontractors.find(s => s.email === customer.installer || s.user_email === customer.installer);
      const matched = byName || byEmail;
      autoCrew = matched ? [matched.name] : [customer.installer];
    }

    setForm((f) => ({
      ...f,
      customer_name: customer.name || '',
      customer_id: customer.id || '',
      address: addr,
      customer_phone: customer.phone || customer.phone_2 || f.customer_phone,
      customer_email: customer.email || f.customer_email,
      insurance_claim_number: customer.insurance_company || customer.insurance_claim_number || f.insurance_claim_number,
      rep: autoRep || f.rep,
      assigned_to: autoAssigned.length > 0 ? autoAssigned : f.assigned_to,
      crew: autoCrew.length > 0 ? autoCrew : f.crew,
    }));
    setCustomerSearch('');
  }

  // ---- Send crew upload link ----
  const sendCrewUploadLink = async (build) => {
    if (sendingCrewLink) return;
    const crewNames = Array.isArray(build.crew) ? build.crew : (build.crew ? [build.crew] : []);
    if (crewNames.length === 0) {
      toast.info('No crew assigned', { description: 'Add subcontractors to this build\'s Crew field first.' });
      return;
    }
    if (!build.customer_id && !build.customer_name) {
      toast.error('No customer linked to this build.');
      return;
    }
    setSendingCrewLink(build.id);
    try {
      // 1. Resolve customer and ensure portal_token
      let cust = customers.find((c) => c.id === build.customer_id)
        || customers.find((c) => c.name === build.customer_name);
      if (!cust && build.customer_id) {
        try { cust = await base44.entities.Customer.get(build.customer_id); } catch (_) {}
      }
      if (!cust) {
        toast.error('Customer not found', { description: 'The linked customer record could not be loaded.' });
        return;
      }
      let portalToken = cust.portal_token;
      if (!portalToken) {
        portalToken = window.crypto.randomUUID();
        await base44.entities.Customer.update(cust.id, { portal_token: portalToken });
        queryClient.invalidateQueries({ queryKey: ['customer', cust.id] });
      }
      const uploadUrl = `${window.location.origin}/crew-upload?token=${encodeURIComponent(portalToken)}&cid=${encodeURIComponent(cust.id)}`;

      // 2. Build message
      const companyName = myCompany?.company_name || 'Your Contractor';
      const jobAddr = build.address || cust.street || '';
      const customerLabel = build.customer_name || cust.name || 'Job';
      const smsText = `📸 Crew upload link — ${customerLabel}${jobAddr ? '\n📍 ' + jobAddr : ''}\n\nTap to upload job site photos:\n${uploadUrl}\n\n— ${companyName}`;

      // 3. Match crew names → Subcontractor records
      let sentSms = 0, sentEmail = 0;
      const noContact = [];
      for (const crewName of crewNames) {
        const sub = subcontractors.find((s) => s.name === crewName || s.full_name === crewName);
        const phone = sub?.phone || sub?.cell_phone;
        const email = sub?.email;
        if (phone) {
          try {
            await base44.functions.invoke('sendSMS', { to: phone, message: smsText, companyId });
            sentSms++;
          } catch (_) { /* non-fatal — still count remaining */ }
        } else if (email) {
          try {
            const subject = `📸 Crew upload link — ${customerLabel}`;
            const html = `<div style="font-family:Arial,sans-serif;color:#333;max-width:600px;">
              <h2 style="color:#1d4ed8;">📸 Crew Photo Upload</h2>
              <p><strong>Job:</strong> ${customerLabel}</p>
              ${jobAddr ? `<p><strong>Address:</strong> ${jobAddr}</p>` : ''}
              <p style="margin:20px 0;">
                <a href="${uploadUrl}" style="background:#1d4ed8;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">
                  Tap to Upload Photos
                </a>
              </p>
              <p style="font-size:12px;color:#6b7280;">Or copy: ${uploadUrl}</p>
              <p style="font-size:12px;color:#9ca3af;">— ${companyName}</p>
            </div>`;
            await base44.functions.invoke('sendEmailWithBranding', { to: email, companyId, subject, html });
            sentEmail++;
          } catch (_) { /* non-fatal */ }
        } else {
          noContact.push(crewName);
        }
      }

      // 4. Feedback
      const parts = [];
      if (sentSms > 0) parts.push(`${sentSms} SMS`);
      if (sentEmail > 0) parts.push(`${sentEmail} email`);
      if (parts.length > 0) {
        toast.success(`Upload link sent — ${parts.join(' + ')}`, {
          description: noContact.length > 0
            ? `${noContact.join(', ')} skipped — no phone or email on file.`
            : 'All assigned crew notified.',
        });
      } else if (noContact.length > 0) {
        toast.warning('No crew could be reached', {
          description: `${noContact.join(', ')} — add phone or email to their Subcontractor record.`,
        });
      }
    } catch (err) {
      toast.error('Failed to send upload link', { description: err.message });
    } finally {
      setSendingCrewLink(null);
    }
  };

  // ---- Scope of Work handlers ----
  function handleGenerateScope() {
    const est = activeEstimate;
    const estimateItems = est ? estimateItemsToScopeItems(est) : [];
    const templateItems = templateItemsForJobTypes(form.job_type, customTemplateMap);
    const generated = [...estimateItems, ...templateItems];
    if (generated.length === 0) {
      toast.error('Nothing to generate', {
        description: 'Pick a job type or link an estimate with line items first.',
      });
      return;
    }
    const merged = mergeScopeItems(form.scope_of_work || [], generated);
    setForm((f) => ({
      ...f,
      scope_of_work: merged,
      scope_estimate_id: est?.id || f.scope_estimate_id || '',
      scope_generated_at: new Date().toISOString(),
    }));
    toast.success('Scope of work ready', { description: `${merged.length} items on the checklist.` });
  }

  function handleToggleItem(itemId) {
    setForm((f) => ({ ...f, scope_of_work: toggleScopeItem(f.scope_of_work || [], itemId, user) }));
  }

  // Mark all / uncheck all act on the BUILD scope only — punch items are
  // close-out work tracked separately and are never bulk-completed here.
  function handleCheckAll() {
    const now = new Date().toISOString();
    const who = user?.email || user?.full_name || 'staff';
    setForm((f) => ({
      ...f,
      scope_of_work: (f.scope_of_work || []).map((it) =>
        it.completed || isPunchItem(it) ? it : { ...it, completed: true, completed_by: who, completed_at: now }
      ),
    }));
    setCheckAllConfirmOpen(false);
  }

  function handleUncheckAll() {
    setForm((f) => ({
      ...f,
      scope_of_work: (f.scope_of_work || []).map((it) =>
        !it.completed || isPunchItem(it) ? it : { ...it, completed: false, completed_by: '', completed_at: '' }
      ),
    }));
  }

  function handleAddManualItem() {
    const label = newItemLabel.trim();
    if (!label) return;
    setForm((f) => ({
      ...f,
      scope_of_work: [...(f.scope_of_work || []), makeScopeItem({ label, category: 'manual' })],
    }));
    setNewItemLabel('');
  }

  function handleAddPunchItem() {
    const label = newPunchLabel.trim();
    if (!label) return;
    setForm((f) => ({
      ...f,
      scope_of_work: [...(f.scope_of_work || []), makeScopeItem({ label, category: PUNCH_CATEGORY })],
    }));
    setNewPunchLabel('');
  }

  function handleRemoveItem(itemId) {
    setForm((f) => ({
      ...f,
      scope_of_work: (f.scope_of_work || []).filter((it) => it.id !== itemId),
    }));
  }

  function handleItemNote(itemId, text) {
    setForm((f) => ({
      ...f,
      scope_of_work: (f.scope_of_work || []).map((it) =>
        it.id === itemId ? { ...it, notes: text } : it,
      ),
    }));
  }

  function handleRemovePhoto(itemId, url) {
    setForm((f) => ({
      ...f,
      scope_of_work: (f.scope_of_work || []).map((it) =>
        it.id === itemId
          ? { ...it, photo_urls: (it.photo_urls || []).filter((u) => u !== url) }
          : it,
      ),
    }));
  }

  async function handleItemPhoto(itemId, file) {
    if (!file) return;
    setUploadingItemId(itemId);
    try {
      const res = await base44.integrations.Core.UploadFile({ file });
      const url = res?.file_url;
      if (!url) throw new Error('No file URL returned');
      setForm((f) => ({
        ...f,
        scope_of_work: (f.scope_of_work || []).map((it) =>
          it.id === itemId
            ? { ...it, photo_urls: [...(it.photo_urls || []), url] }
            : it,
        ),
      }));
      toast.success('Photo attached');
    } catch (err) {
      toast.error('Upload failed', { description: err.message });
    } finally {
      setUploadingItemId(null);
    }
  }

  function persistBuild(missingLabels) {
    const payload = { ...form, company_id: companyId, last_activity_at: new Date().toISOString() };
    if (missingLabels && missingLabels.length > 0) {
      payload.scope_completion_override_at = new Date().toISOString();
      payload.scope_completion_override_by = user?.email || user?.full_name || 'staff';
      payload.scope_completion_missing = missingLabels;
    }
    saveMutation.mutate(payload);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.customer_name || !form.build_date) {
      toast.error('Missing fields', { description: 'Customer name and build date are required.' });
      return;
    }
    if (form.job_type.length === 0) {
      toast.error('Missing job type', { description: 'Please select at least one job type.' });
      return;
    }
    // Soft completion gate: warn (don't block) when marking a build "Completed"
    // while scope-of-work items are still unchecked.
    if (form.status === 'completed') {
      const prog = scopeProgress(form.scope_of_work || []);
      if (prog.total > 0 && prog.remaining > 0) {
        setPendingMissing(prog.incompleteLabels);
        setScopeWarnOpen(true);
        return;
      }
    }
    persistBuild(null);
  }

  function confirmCompleteAnyway() {
    setScopeWarnOpen(false);
    persistBuild(pendingMissing);
    setPendingMissing([]);
  }

  const statusObj = (s) => BUILD_STATUSES.find((st) => st.value === s) || BUILD_STATUSES[0];

  function SortIcon({ field }) {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 inline ml-1" /> : <ChevronDown className="w-3 h-3 inline ml-1" />;
  }

  const todayStr = localToday();
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
      <div className="p-3 sm:p-6 text-center text-gray-500">Loading company info...</div>
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
              <SelectItem value="active">Active Only</SelectItem>
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
          {(dateFrom || dateTo || repFilter !== 'all' || crewFilter !== 'all' || (statusFilter !== 'all' && statusFilter !== 'active')) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setDateFrom(''); setDateTo(''); setRepFilter('all'); setCrewFilter('all'); setStatusFilter('active'); }}
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
                          <div className="mt-1 text-[11px] text-gray-500 flex items-center gap-1" title={build.created_by || undefined}>
                            <User className="w-3 h-3 text-gray-400" />
                            <span>Scheduled by {build.created_by_name || build.created_by || 'Unknown'}</span>
                          </div>
                          {Array.isArray(build.scope_of_work) && build.scope_of_work.length > 0 && (() => {
                            const p = scopeProgress(build.scope_of_work);
                            const punch = punchProgress(build.scope_of_work);
                            return (
                              <>
                                {p.total > 0 && (
                                  <div
                                    className={`text-[10px] mt-1 flex items-center gap-1 ${p.allDone ? 'text-emerald-600' : 'text-amber-600'}`}
                                    data-testid={`scope-progress-${build.id}`}
                                    title={p.allDone ? 'Scope of work complete' : `${p.remaining} item(s) left`}
                                  >
                                    <ListChecks className="w-3 h-3" /> {p.done}/{p.total}
                                  </div>
                                )}
                                {punch.remaining > 0 && (
                                  <div
                                    className="text-[10px] mt-0.5 flex items-center gap-1 text-orange-600"
                                    data-testid={`punch-progress-${build.id}`}
                                    title={`${punch.remaining} punch item(s) still open`}
                                  >
                                    <ClipboardList className="w-3 h-3" /> {punch.remaining} punch
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                              onClick={() => sendCrewUploadLink(build)}
                              disabled={sendingCrewLink === build.id}
                              title="Send crew upload link"
                              data-testid={`button-send-crew-link-${build.id}`}
                            >
                              {sendingCrewLink === build.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Share2 className="w-3.5 h-3.5" />}
                            </Button>
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
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
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
                    <ChevronDown className="w-4 h-4 opacity-50" />
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

            <div className="space-y-3">
              <div>
                <Label className="mb-2 block">Crew {form.crew.length > 0 && <span className="text-blue-600 font-normal">({form.crew.length} selected)</span>}</Label>
                {subcontractors.length === 0 ? (
                  <p className="text-xs text-gray-400">No subcontractors available</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {subcontractors.map((s) => {
                      const isSelected = form.crew.includes(s.name);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          data-testid={`chip-crew-${s.id}`}
                          onClick={() => setForm((f) => ({
                            ...f,
                            crew: isSelected ? f.crew.filter((c) => c !== s.name) : [...f.crew, s.name]
                          }))}
                          className={`px-3 py-2 rounded-full text-sm font-medium border transition-colors select-none ${
                            isSelected
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                          }`}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {form.crew.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 gap-1.5 text-blue-600 border-blue-300 hover:bg-blue-50"
                    disabled={!!sendingCrewLink}
                    onClick={() => {
                      if (!editingId) {
                        toast.info('Save the build first', { description: 'Save this build before sending the crew upload link.' });
                        return;
                      }
                      const savedBuild = builds.find((b) => b.id === editingId);
                      sendCrewUploadLink({ ...savedBuild, ...form, id: editingId });
                    }}
                  >
                    {sendingCrewLink === editingId ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Share2 className="w-4 h-4" />
                    )}
                    Send link to crew
                  </Button>
                )}
              </div>

              <div>
                <Label className="mb-2 block">Assigned To {form.assigned_to.length > 0 && <span className="text-blue-600 font-normal">({form.assigned_to.length} selected)</span>}</Label>
                {allStaff.length === 0 ? (
                  <p className="text-xs text-gray-400">No staff available</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {allStaff.map((s) => {
                      const staffName = s.name || s.full_name || s.email;
                      const isSelected = form.assigned_to.includes(staffName);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          data-testid={`chip-assigned-${s.id}`}
                          onClick={() => setForm((f) => ({
                            ...f,
                            assigned_to: isSelected ? f.assigned_to.filter((a) => a !== staffName) : [...f.assigned_to, staffName]
                          }))}
                          className={`px-3 py-2 rounded-full text-sm font-medium border transition-colors select-none ${
                            isSelected
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                          }`}
                        >
                          {staffName}
                        </button>
                      );
                    })}
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
                    <ChevronDown className="w-4 h-4 opacity-50" />
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
              <Label>Waiting reason (optional)</Label>
              <Select
                value={form.waiting_reason || 'none'}
                onValueChange={(v) => setForm((f) => ({ ...f, waiting_reason: v === 'none' ? '' : v }))}
              >
                <SelectTrigger data-testid="select-waiting-reason">
                  <SelectValue placeholder="Not waiting" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not waiting</SelectItem>
                  <SelectItem value="Insurance/adjuster">Insurance/adjuster</SelectItem>
                  <SelectItem value="Materials">Materials</SelectItem>
                  <SelectItem value="Permit/HOA">Permit/HOA</SelectItem>
                  <SelectItem value="Customer">Customer</SelectItem>
                  <SelectItem value="Other trade">Other trade</SelectItem>
                </SelectContent>
              </Select>
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

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="send_customer_reminders"
                checked={!!form.send_customer_reminders}
                onChange={(e) => setForm((f) => ({ ...f, send_customer_reminders: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300"
                data-testid="checkbox-send-customer-reminders"
              />
              <label htmlFor="send_customer_reminders" className="text-sm text-gray-600 cursor-pointer select-none">
                Send appointment reminders to homeowner (24 hr &amp; 1 hr before)
              </label>
            </div>

            {(() => {
              const scopeItems = form.scope_of_work || [];
              const scopeStats = scopeProgress(scopeItems);
              const punchStats = punchProgress(scopeItems);
              const buildItemCount = buildScopeItems(scopeItems).length;
              const SCOPE_GROUPS = [
                { key: 'estimate', label: SCOPE_CATEGORY_LABELS.estimate },
                { key: 'template', label: SCOPE_CATEGORY_LABELS.template },
                { key: 'manual', label: SCOPE_CATEGORY_LABELS.manual },
                { key: PUNCH_CATEGORY, label: SCOPE_CATEGORY_LABELS.punch },
              ];
              return (
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="flex items-center gap-1.5 text-base font-semibold">
                      <ListChecks className="w-4 h-4 text-blue-600" />
                      Scope of Work
                    </Label>
                    {(buildItemCount > 0 || punchStats.total > 0) && (
                      <div className="flex items-center gap-2">
                        {buildItemCount > 0 && (
                          <Badge
                            variant="outline"
                            className={scopeStats.allDone ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}
                            data-testid="badge-scope-progress"
                          >
                            {scopeStats.done}/{scopeStats.total} done
                          </Badge>
                        )}
                        {punchStats.total > 0 && (
                          <Badge
                            variant="outline"
                            className={punchStats.allDone ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-orange-50 text-orange-700 border-orange-200'}
                            data-testid="badge-punch-progress"
                            title={punchStats.allDone ? 'Punch list complete' : `${punchStats.remaining} punch item(s) left`}
                          >
                            Punch {punchStats.done}/{punchStats.total}
                          </Badge>
                        )}
                        {buildItemCount === 0 ? null : scopeStats.allDone ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={handleUncheckAll}
                            className="h-6 px-2 text-xs text-gray-500 hover:text-gray-700"
                            data-testid="button-uncheck-all"
                          >
                            Uncheck all
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setCheckAllConfirmOpen(true)}
                            className="h-6 px-2 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                            data-testid="button-mark-all-done"
                          >
                            Mark all done
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {estimatesWithItems.length > 1 && (
                    <div className="mb-2">
                      <Label className="text-xs text-gray-500">Build checklist from estimate</Label>
                      <Select value={selectedEstimateId} onValueChange={setSelectedEstimateId}>
                        <SelectTrigger data-testid="select-scope-estimate">
                          <SelectValue placeholder="Recommended estimate" />
                        </SelectTrigger>
                        <SelectContent>
                          {estimatesWithItems.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {(e.estimate_number || e.number || 'Estimate')} · {e.items.length} items
                              {e.status ? ` · ${e.status}` : ''}
                              {e.id === recommendedEstimate?.id ? ' (recommended)' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateScope}
                      data-testid="button-generate-scope"
                    >
                      <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                      {scopeItems.length > 0 ? 'Refresh from estimate + steps' : 'Generate checklist'}
                    </Button>
                    {activeEstimate ? (
                      <span className="text-xs text-gray-400">
                        Using estimate {activeEstimate.estimate_number || activeEstimate.number || ''}
                      </span>
                    ) : form.customer_id ? (
                      <span className="text-xs text-gray-400">No estimate found — standard steps only</span>
                    ) : (
                      <span className="text-xs text-gray-400">Select a customer to pull their estimate</span>
                    )}
                  </div>

                  {scopeItems.length === 0 ? (
                    <p className="text-sm text-gray-400 mb-2">
                      No checklist yet. Click “Generate checklist” to build one from this customer’s
                      estimate and your standard steps for the selected job type(s).
                    </p>
                  ) : (
                    <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                      {SCOPE_GROUPS.map((g) => {
                        const gItems = scopeItems.filter((it) => (it.category || 'manual') === g.key);
                        if (gItems.length === 0) return null;
                        const isPunchGroup = g.key === PUNCH_CATEGORY;
                        return (
                          <div key={g.key}>
                            <div
                              className={`text-[11px] font-semibold uppercase tracking-wide mb-1 ${isPunchGroup ? 'text-orange-500' : 'text-gray-400'}`}
                              data-testid={isPunchGroup ? 'group-punch-list' : undefined}
                            >
                              {g.label}
                            </div>
                            <div className="space-y-1">
                              {gItems.map((it) => (
                                <div
                                  key={it.id}
                                  className="flex items-start gap-2 rounded-md border p-2"
                                  data-testid={`scope-item-${it.id}`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => handleToggleItem(it.id)}
                                    className="mt-0.5 flex-shrink-0"
                                    data-testid={`toggle-scope-${it.id}`}
                                    aria-label={it.completed ? 'Mark not done' : 'Mark done'}
                                  >
                                    {it.completed ? (
                                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                    ) : (
                                      <Circle className="w-5 h-5 text-gray-300" />
                                    )}
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <div className={`text-sm ${it.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                      {it.label}
                                    </div>
                                    {it.completed && it.completed_by && (
                                      <div className="text-[10px] text-gray-400">✓ {it.completed_by}</div>
                                    )}
                                    {Array.isArray(it.photo_urls) && it.photo_urls.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {it.photo_urls.map((url) => (
                                          <div key={url} className="relative">
                                            <a href={url} target="_blank" rel="noreferrer">
                                              <img src={url} alt="proof" className="w-10 h-10 object-cover rounded border" />
                                            </a>
                                            <button
                                              type="button"
                                              onClick={() => handleRemovePhoto(it.id, url)}
                                              className="absolute -top-1 -right-1 bg-white rounded-full border shadow-sm"
                                              aria-label="Remove photo"
                                            >
                                              <X className="w-3 h-3 text-gray-500" />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {noteEditingId === it.id ? (
                                      <Textarea
                                        value={it.notes || ''}
                                        onChange={(e) => handleItemNote(it.id, e.target.value)}
                                        onBlur={() => setNoteEditingId(null)}
                                        autoFocus
                                        rows={2}
                                        placeholder="Add a note..."
                                        className="mt-1 text-xs"
                                        data-testid={`note-input-scope-${it.id}`}
                                      />
                                    ) : it.notes ? (
                                      <button
                                        type="button"
                                        onClick={() => setNoteEditingId(it.id)}
                                        className="mt-1 block w-full text-left text-[11px] text-gray-500 whitespace-pre-wrap hover:text-gray-700"
                                        data-testid={`note-text-scope-${it.id}`}
                                      >
                                        📝 {it.notes}
                                      </button>
                                    ) : null}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setNoteEditingId(noteEditingId === it.id ? null : it.id)}
                                    className={`flex-shrink-0 mt-0.5 ${it.notes ? 'text-blue-500' : 'text-gray-400'} hover:text-blue-600`}
                                    title={it.notes ? 'Edit note' : 'Add a note'}
                                    aria-label={it.notes ? 'Edit note' : 'Add a note'}
                                    data-testid={`note-scope-${it.id}`}
                                  >
                                    <StickyNote className="w-4 h-4" />
                                  </button>
                                  <label
                                    className="flex-shrink-0 cursor-pointer text-gray-400 hover:text-blue-600 mt-0.5"
                                    title="Attach photo proof"
                                  >
                                    {uploadingItemId === it.id ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Camera className="w-4 h-4" />
                                    )}
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        e.target.value = '';
                                        handleItemPhoto(it.id, file);
                                      }}
                                      data-testid={`photo-scope-${it.id}`}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveItem(it.id)}
                                    className="flex-shrink-0 text-gray-300 hover:text-red-500 mt-0.5"
                                    title="Remove item"
                                    data-testid={`remove-scope-${it.id}`}
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex gap-2 mt-2">
                    <Input
                      value={newItemLabel}
                      onChange={(e) => setNewItemLabel(e.target.value)}
                      placeholder="Add a custom step..."
                      className="h-8 text-sm"
                      data-testid="input-add-scope-item"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddManualItem();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddManualItem}
                      data-testid="button-add-scope-item"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  {/* Punch list: close-out items found on the final walkthrough.
                      Same checklist item shape (photos / notes / who-when), but
                      counted separately from the build scope above. */}
                  <div className="flex gap-2 mt-2">
                    <Input
                      value={newPunchLabel}
                      onChange={(e) => setNewPunchLabel(e.target.value)}
                      placeholder="Add a punch list item..."
                      className="h-8 text-sm border-orange-200 focus-visible:ring-orange-400"
                      data-testid="input-add-punch-item"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddPunchItem();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddPunchItem}
                      className="border-orange-200 text-orange-600 hover:bg-orange-50 hover:text-orange-700"
                      data-testid="button-add-punch-item"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })()}

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

      <AlertDialog open={checkAllConfirmOpen} onOpenChange={setCheckAllConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              Mark all {buildScopeItems(form.scope_of_work || []).length} items done?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This checks off every item on the scope of work at once. You can still uncheck individual items or use "Uncheck all" to undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-check-all-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCheckAll}
              className="bg-emerald-600 hover:bg-emerald-700"
              data-testid="button-check-all-confirm"
            >
              Yes, mark all done
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={scopeWarnOpen} onOpenChange={setScopeWarnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Some work isn’t checked off yet
            </AlertDialogTitle>
            <AlertDialogDescription>
              You’re marking this build as <strong>Completed</strong>, but{' '}
              {pendingMissing.length} item{pendingMissing.length === 1 ? '' : 's'} on the scope of
              work {pendingMissing.length === 1 ? 'is' : 'are'} still unchecked:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-48 overflow-y-auto rounded-md bg-amber-50 border border-amber-200 p-3 my-1">
            <ul className="list-disc list-inside space-y-1 text-sm text-amber-800">
              {pendingMissing.map((label, i) => (
                <li key={i} data-testid={`missing-item-${i}`}>{label}</li>
              ))}
            </ul>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-scope-warn-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCompleteAnyway}
              className="bg-blue-600 hover:bg-blue-700"
              data-testid="button-scope-warn-confirm"
            >
              Save as Completed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
