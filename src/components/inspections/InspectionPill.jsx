import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Camera, Calendar, CheckCircle2, FileText, Loader2, Eye, AlertTriangle, RefreshCw } from "lucide-react";
import { createPageUrl } from "@/utils";

// ─── Module-level helpers (must be declared before any function that uses them) ─
// Declared at the top so esbuild's minifier never assigns them a name that
// lands in the TDZ when the hoisted function declarations are evaluated.
const normalize = (v) => (v || '').toString().trim();
const normalizePhone = (v) => normalize(v).replace(/\D+/g, '');
const normalizeEmail = (v) => normalize(v).toLowerCase();

// Inline pill that summarizes the inspection state for one record
// (a Lead or a Customer). Click to open a popover with scheduled date,
// inspector, photos, drone/ladder badges and a jump-to-inspection button.
export function InspectionPill({ record, job, photoCount, navigate }) {
  const id = record?.id || 'unknown';
  if (!job) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); navigate(createPageUrl('InspectionsDashboard')); }}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200"
        data-testid={`pill-inspection-none-${id}`}
        title="No inspection on file. Click to open the Inspections dashboard."
      >
        <Camera className="w-3 h-3" />
        Not Inspected
      </button>
    );
  }

  const inspector = job.assigned_to_name || (job.assigned_to_email ? job.assigned_to_email.split('@')[0] : '');
  const initials = inspector ? inspector.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase() : '?';
  const sd = job.scheduled_date || job.inspection_date || job.created_date;
  let dateStr = '';
  try { dateStr = sd ? format(new Date(sd), 'M/d') : ''; } catch { dateStr = ''; }

  let label = 'Scheduled';
  let color = 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100';
  let icon = <Calendar className="w-3 h-3" />;
  if (job.status === 'completed') {
    label = 'Inspected';
    color = 'bg-green-50 text-green-800 border-green-300 hover:bg-green-100';
    icon = <CheckCircle2 className="w-3 h-3" />;
  } else if (job.status === 'in_progress') {
    label = 'In Progress';
    color = 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100';
    icon = <Loader2 className="w-3 h-3" />;
  } else if (job.status === 'draft') {
    label = 'Draft';
    color = 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100';
    icon = <FileText className="w-3 h-3" />;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border ${color}`}
          data-testid={`pill-inspection-${job.status}-${id}`}
        >
          {icon}
          <span>{label}</span>
          {dateStr && <span className="opacity-80">{dateStr}</span>}
          {inspector && (
            <span className="ml-0.5 px-1 rounded-sm bg-white/60 text-[10px] font-bold border border-current/20" title={inspector}>
              {initials}
            </span>
          )}
          {photoCount > 0 && (
            <span className="inline-flex items-center gap-0.5 ml-0.5">
              <Camera className="w-3 h-3" />
              {photoCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" onClick={(e) => e.stopPropagation()}>
        <InspectionPopoverContent
          job={job}
          inspector={inspector}
          dateStr={dateStr}
          photoCount={photoCount}
          navigate={navigate}
        />
      </PopoverContent>
    </Popover>
  );
}

// Popover body — fetches the latest InspectionReport's AI summary lazily.
function InspectionPopoverContent({ job, inspector, dateStr, photoCount, navigate }) {
  const { data: reports = [] } = useQuery({
    queryKey: ['inspection-reports-pop', job.id],
    queryFn: () => base44.entities.InspectionReport.filter({ inspection_job_id: job.id }, '-created_date', 1),
    enabled: !!job.id,
  });
  const summary = reports[0]?.ai_summary || reports[0]?.summary || '';
  const truncated = summary && summary.length > 220 ? summary.slice(0, 220) + '…' : summary;

  return (
    <div className="space-y-2 text-sm" data-testid={`popover-inspection-${job.id}`}>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-gray-900">Inspection</span>
        <Badge variant="outline" className="text-[10px] capitalize">{(job.status || 'unknown').replace('_', ' ')}</Badge>
      </div>
      <LeadNameMismatchWarning job={job} />
      <LeadContactMismatchWarning job={job} />
      <CustomerNameMismatchWarning job={job} />
      <CustomerContactMismatchWarning job={job} />

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-700">
        <div><span className="text-gray-500">Date:</span> {dateStr || '—'}</div>
        <div><span className="text-gray-500">Inspector:</span> {inspector || '—'}</div>
        <div><span className="text-gray-500">Photos:</span> {photoCount || 0}</div>
        <div className="truncate"><span className="text-gray-500">Address:</span> {job.property_address || '—'}</div>
      </div>
      <div className="flex flex-wrap gap-1">
        {job.ladder_assist_needed && (
          <Badge variant="outline" className="bg-yellow-50 border-yellow-300 text-yellow-800 text-[10px]">
            💵 Ladder ${job.ladder_assist_cost || 100}
          </Badge>
        )}
        {job.drone_pilot_needed && (
          <Badge variant="outline" className="bg-blue-50 border-blue-300 text-blue-800 text-[10px]" data-testid={`badge-popover-drone-${job.id}`}>
            🚁 Drone ${job.drone_pilot_cost || 150}
          </Badge>
        )}
      </div>
      {truncated ? (
        <div className="rounded-md bg-purple-50 border border-purple-100 p-2 text-xs text-purple-900">
          <div className="font-semibold mb-0.5">AI Damage Summary</div>
          {truncated}
        </div>
      ) : (
        <div className="text-xs text-gray-400 italic">No AI damage summary yet.</div>
      )}
      <Button
        size="sm"
        className="w-full"
        onClick={() => navigate(createPageUrl('InspectionReports') + `?jobId=${job.id}`)}
        data-testid={`button-open-inspection-${job.id}`}
      >
        <Eye className="w-3.5 h-3.5 mr-1" /> Open Inspection
      </Button>
    </div>
  );
}

// Subtle warning that surfaces when an InspectionJob's saved client_name no
// longer matches the linked Lead's current name (lead was renamed after the
// job was created). Includes a one-click "Sync name" action that copies the
// Lead's name back onto the job so reports/PDFs stay in sync.
export function LeadNameMismatchWarning({ job, className = "", compact = false }) {
  const queryClient = useQueryClient();
  const leadId = job?.related_lead_id || null;

  const { data: lead } = useQuery({
    queryKey: ['lead-for-name-check', leadId],
    queryFn: async () => {
      const res = await base44.entities.Lead.filter({ id: leadId });
      return res?.[0] || null;
    },
    enabled: !!leadId,
  });

  const syncMutation = useMutation({
    mutationFn: () => base44.entities.InspectionJob.update(job.id, { client_name: lead.name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspectionJob', job.id] });
      queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
      queryClient.invalidateQueries({ queryKey: ['company-inspections'] });
    },
  });

  const leadName = (lead?.name || '').trim();
  const jobName = (job?.client_name || '').trim();
  if (!leadId || !leadName || !jobName) return null;
  if (leadName.toLowerCase() === jobName.toLowerCase()) return null;

  return (
    <div
      className={`flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 ${className}`}
      data-testid={`warning-name-mismatch-${job.id}`}
    >
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold">Name doesn't match the linked lead</div>
        {!compact && (
          <div className="text-amber-800">
            Inspection: <span className="font-medium">{jobName}</span> · Lead:{' '}
            <span className="font-medium">{leadName}</span>
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 border-amber-400 text-amber-900 hover:bg-amber-100"
        onClick={(e) => { e.stopPropagation(); syncMutation.mutate(); }}
        disabled={syncMutation.isPending}
        data-testid={`button-sync-name-${job.id}`}
      >
        {syncMutation.isPending ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <><RefreshCw className="w-3 h-3 mr-1" /> Sync name</>
        )}
      </Button>
    </div>
  );
}

// Same heads-up as LeadNameMismatchWarning, but for inspections that are
// linked to a Customer instead of a Lead. Renders nothing unless the job
// has a related_customer_id and the saved client_name disagrees with the
// linked Customer's current name.
export function CustomerNameMismatchWarning({ job, className = "", compact = false }) {
  const queryClient = useQueryClient();
  const customerId = job?.related_customer_id || null;

  const { data: customer } = useQuery({
    queryKey: ['customer-for-name-check', customerId],
    queryFn: async () => {
      const res = await base44.entities.Customer.filter({ id: customerId });
      return res?.[0] || null;
    },
    enabled: !!customerId,
  });

  const syncMutation = useMutation({
    mutationFn: () => base44.entities.InspectionJob.update(job.id, { client_name: customer.name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspectionJob', job.id] });
      queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
      queryClient.invalidateQueries({ queryKey: ['company-inspections'] });
    },
  });

  const customerName = (customer?.name || '').trim();
  const jobName = (job?.client_name || '').trim();
  if (!customerId || !customerName || !jobName) return null;
  if (customerName.toLowerCase() === jobName.toLowerCase()) return null;

  return (
    <div
      className={`flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 ${className}`}
      data-testid={`warning-customer-name-mismatch-${job.id}`}
    >
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold">Name doesn't match the linked customer</div>
        {!compact && (
          <div className="text-amber-800">
            Inspection: <span className="font-medium">{jobName}</span> · Customer:{' '}
            <span className="font-medium">{customerName}</span>
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 border-amber-400 text-amber-900 hover:bg-amber-100"
        onClick={(e) => { e.stopPropagation(); syncMutation.mutate(); }}
        disabled={syncMutation.isPending}
        data-testid={`button-sync-customer-name-${job.id}`}
      >
        {syncMutation.isPending ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <><RefreshCw className="w-3 h-3 mr-1" /> Sync name</>
        )}
      </Button>
    </div>
  );
}

// Build a single-line address from a Lead or Customer's parts. Matches the
// way NewInspection/Customers compose property_address so comparisons stay
// apples-to-apples.
function composeAddressFromParts(record) {
  if (!record) return '';
  // Mirror AssignmentDialog snapshot order: prefer the single-line `address`
  // when present, otherwise join the parts. Keeping the same precedence
  // avoids false-positive drift warnings caused only by formatting choice.
  if (record.address && record.address.trim()) return record.address.trim();
  const parts = [record.street, record.city, record.state, record.zip].filter(Boolean);
  return parts.join(', ');
}

// Compute which contact fields drift between an InspectionJob and its
// linked Lead/Customer. Returns an array of { key, label, jobValue,
// recordValue, updates } describing each mismatch and the InspectionJob
// patch needed to sync it.
function getContactMismatches(job, record, { phoneField, emailField }) {
  if (!job || !record) return [];
  const mismatches = [];

  const recordAddress = composeAddressFromParts(record);
  const jobAddress = normalize(job.property_address);
  if (recordAddress && normalize(recordAddress).toLowerCase() !== jobAddress.toLowerCase()) {
    mismatches.push({
      key: 'address',
      label: 'Address',
      jobValue: jobAddress || '—',
      recordValue: recordAddress,
      updates: { property_address: recordAddress },
    });
  }

  const recordPhone = normalize(record[phoneField]);
  const jobPhone = normalize(job.client_phone);
  if (recordPhone && normalizePhone(recordPhone) !== normalizePhone(jobPhone)) {
    mismatches.push({
      key: 'phone',
      label: 'Phone',
      jobValue: jobPhone || '—',
      recordValue: recordPhone,
      updates: { client_phone: recordPhone },
    });
  }

  const recordEmail = normalize(record[emailField]);
  const jobEmail = normalize(job.client_email);
  if (recordEmail && normalizeEmail(recordEmail) !== normalizeEmail(jobEmail)) {
    mismatches.push({
      key: 'email',
      label: 'Email',
      jobValue: jobEmail || '—',
      recordValue: recordEmail,
      updates: { client_email: recordEmail },
    });
  }

  return mismatches;
}

// Shared UI for the address/phone/email drift heads-up. Renders nothing
// when nothing has drifted. The Sync button copies every mismatched
// field's current value from the linked Lead/Customer back onto the
// InspectionJob in one update.
function ContactMismatchWarning({
  job,
  mismatches,
  recordLabel,
  testIdSuffix,
  className = "",
  compact = false,
}) {
  const queryClient = useQueryClient();
  const syncMutation = useMutation({
    mutationFn: () => {
      const updates = mismatches.reduce((acc, m) => ({ ...acc, ...m.updates }), {});
      return base44.entities.InspectionJob.update(job.id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspectionJob', job.id] });
      queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
      queryClient.invalidateQueries({ queryKey: ['company-inspections'] });
    },
  });

  if (!mismatches || mismatches.length === 0) return null;

  const summary = mismatches.map((m) => m.label.toLowerCase()).join(', ');
  const buttonLabel = mismatches.length === 1
    ? `Sync ${mismatches[0].label.toLowerCase()}`
    : 'Sync all';

  return (
    <div
      className={`flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 ${className}`}
      data-testid={`warning-${testIdSuffix}-${job.id}`}
    >
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold">
          {mismatches.length === 1 ? `${mismatches[0].label} doesn't match` : 'Contact info doesn\'t match'} the linked {recordLabel}
        </div>
        {!compact && (
          <div className="text-amber-800 space-y-0.5 mt-0.5">
            {mismatches.map((m) => (
              <div key={m.key} className="truncate">
                <span className="text-amber-700">{m.label}:</span>{' '}
                <span className="font-medium line-through opacity-70">{m.jobValue}</span>
                {' → '}
                <span className="font-medium">{m.recordValue}</span>
              </div>
            ))}
          </div>
        )}
        {compact && (
          <div className="text-amber-800">Drifted: {summary}</div>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 border-amber-400 text-amber-900 hover:bg-amber-100"
        onClick={(e) => { e.stopPropagation(); syncMutation.mutate(); }}
        disabled={syncMutation.isPending}
        data-testid={`button-sync-${testIdSuffix}-${job.id}`}
      >
        {syncMutation.isPending ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <><RefreshCw className="w-3 h-3 mr-1" /> {buttonLabel}</>
        )}
      </Button>
    </div>
  );
}

// Heads-up that surfaces when an InspectionJob's saved property_address,
// client_phone, or client_email drift away from the linked Lead's
// current values (lead was updated after the job was created). Includes
// a one-click Sync action that copies the Lead's current values back
// onto the job so reports/PDFs stay in sync.
export function LeadContactMismatchWarning({ job, className = "", compact = false }) {
  const leadId = job?.related_lead_id || null;
  const { data: lead } = useQuery({
    queryKey: ['lead-for-contact-check', leadId],
    queryFn: async () => {
      const res = await base44.entities.Lead.filter({ id: leadId });
      return res?.[0] || null;
    },
    enabled: !!leadId,
  });

  if (!leadId || !lead) return null;
  const mismatches = getContactMismatches(job, lead, { phoneField: 'phone', emailField: 'email' });
  return (
    <ContactMismatchWarning
      job={job}
      mismatches={mismatches}
      recordLabel="lead"
      testIdSuffix="lead-contact-mismatch"
      className={className}
      compact={compact}
    />
  );
}

// Same heads-up as LeadContactMismatchWarning, but for inspections
// linked to a Customer (uses Customer.contact_phone/contact_email and
// the Customer's address parts).
export function CustomerContactMismatchWarning({ job, className = "", compact = false }) {
  const customerId = job?.related_customer_id || null;
  const { data: customer } = useQuery({
    queryKey: ['customer-for-contact-check', customerId],
    queryFn: async () => {
      const res = await base44.entities.Customer.filter({ id: customerId });
      return res?.[0] || null;
    },
    enabled: !!customerId,
  });

  if (!customerId || !customer) return null;
  // Customer entity uses `phone`/`email` (matching what AssignmentDialog
  // snapshots into client_phone/client_email).
  const mismatches = getContactMismatches(job, customer, { phoneField: 'phone', emailField: 'email' });
  return (
    <ContactMismatchWarning
      job={job}
      mismatches={mismatches}
      recordLabel="customer"
      testIdSuffix="customer-contact-mismatch"
      className={className}
      compact={compact}
    />
  );
}

// Hook: load all InspectionJobs + JobMedia for a company and expose
// O(1) lookup helpers keyed by lead id, customer id, or normalized name.
// Both Leads.jsx and Customers.jsx use the same shape so the pill stays
// in sync everywhere.
export function useCompanyInspections(companyId) {
  const { data: inspections = [] } = useQuery({
    queryKey: ['company-inspections', companyId],
    queryFn: () => companyId
      ? base44.entities.InspectionJob.filter({ company_id: companyId }, '-created_date', 500)
      : [],
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: inspectionMedia = [] } = useQuery({
    queryKey: ['company-inspection-media', companyId],
    queryFn: () => companyId
      ? base44.entities.JobMedia.filter({ related_entity_type: 'InspectionJob', company_id: companyId }, '-created_date', 5000)
      : [],
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Strict id-based indexes. Lead-side backfill (see Leads.jsx) keeps older
  // jobs linked via `related_lead_id`, so we never fall back to fragile
  // name matching. Customers are matched on `related_customer_id` only.
  const indexes = React.useMemo(() => {
    const byLeadId = new Map();
    const byCustomerId = new Map();
    const jobDate = (j) => new Date(j.scheduled_date || j.inspection_date || j.created_date || 0).getTime();
    for (const j of inspections || []) {
      if (j.related_lead_id) {
        const prev = byLeadId.get(j.related_lead_id);
        if (!prev || jobDate(j) > jobDate(prev)) byLeadId.set(j.related_lead_id, j);
      }
      if (j.related_customer_id) {
        const prev = byCustomerId.get(j.related_customer_id);
        if (!prev || jobDate(j) > jobDate(prev)) byCustomerId.set(j.related_customer_id, j);
      }
    }
    return { byLeadId, byCustomerId };
  }, [inspections]);

  const photoCountIndex = React.useMemo(() => {
    const m = new Map();
    for (const item of inspectionMedia || []) {
      if (!item.related_entity_id) continue;
      m.set(item.related_entity_id, (m.get(item.related_entity_id) || 0) + 1);
    }
    return m;
  }, [inspectionMedia]);

  const getInspectionForLead = React.useCallback((lead) => {
    if (!lead?.id) return null;
    return indexes.byLeadId.get(lead.id) || null;
  }, [indexes]);

  const getInspectionForCustomer = React.useCallback((customer) => {
    if (!customer?.id) return null;
    return indexes.byCustomerId.get(customer.id) || null;
  }, [indexes]);

  const photoCountForJob = React.useCallback(
    (jobId) => (jobId ? (photoCountIndex.get(jobId) || 0) : 0),
    [photoCountIndex]
  );

  return {
    inspections,
    getInspectionForLead,
    getInspectionForCustomer,
    photoCountForJob,
  };
}
