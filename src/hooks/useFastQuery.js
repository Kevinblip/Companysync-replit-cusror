import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useDashboardPrefetch(companyId) {
  const queryClient = useQueryClient();
  const prefetched = useRef(false);

  useEffect(() => {
    if (!companyId || prefetched.current) return;
    prefetched.current = true;

    const ENTITY_MAP = [
      { key: ['invoices', companyId], type: 'invoices' },
      { key: ['customers', companyId], type: 'customers' },
      { key: ['estimates', companyId], type: 'estimates' },
      { key: ['projects', companyId], type: 'projects' },
      { key: ['leads', companyId], type: 'leads' },
      { key: ['tasks', companyId], type: 'tasks' },
      { key: ['payments', companyId], type: 'payments' },
      { key: ['communications', companyId], type: 'communications' },
      { key: ['staff-profiles', companyId], type: 'staff_profiles' },
    ];

    (async () => {
      try {
        const results = await Promise.allSettled(
          ENTITY_MAP.map(async ({ key, type }) => {
            const existing = queryClient.getQueryData(key);
            if (existing && existing.length > 0) return null;

            const response = await fetch(
              `/api/local/entities/${type}?company_id=${encodeURIComponent(companyId)}&limit=500`
            );
            if (!response.ok) return null;
            const data = await response.json();
            if (!data.records || data.records.length === 0) return null;

            const mapped = data.records.map(r => ({
              ...r.data,
              id: r.base44_id || r.id,
              company_id: r.company_id,
              name: r.name,
              email: r.email,
              phone: r.phone,
              address: r.address,
              status: r.status,
              title: r.title,
              total_amount: r.total_amount ? parseFloat(r.total_amount) : undefined,
              amount_paid: r.amount_paid ? parseFloat(r.amount_paid) : undefined,
              total_value: r.total_value ? parseFloat(r.total_value) : undefined,
              amount: r.amount ? parseFloat(r.amount) : undefined,
              lead_score: r.lead_score,
              source: r.source,
              assigned_to: r.assigned_to,
              service_needed: r.service_needed,
              customer_name: r.customer_name,
              customer_id: r.customer_id,
              invoice_number: r.invoice_number,
              due_date: r.due_date,
              payment_date: r.payment_date,
              payment_method: r.payment_method,
              priority: r.priority,
              start_time: r.start_time,
              end_time: r.end_time,
              event_type: r.event_type,
              location: r.location,
              role: r.role,
              cell_phone: r.cell_phone,
              call_routing_mode: r.call_routing_mode,
              availability_status: r.availability_status,
              direction: r.direction,
              contact_name: r.contact_name,
              subject: r.subject,
              type: r.type,
              notes: r.notes,
              created_date: r.created_at || r.data?.created_date,
              updated_date: r.updated_at || r.data?.updated_date,
            }));

            return { key, records: mapped };
          })
        );

        let prefetchedCount = 0;
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            queryClient.setQueryData(result.value.key, result.value.records);
            prefetchedCount++;
          }
        }

        if (prefetchedCount > 0) {
          console.log(`[FastQuery] Prefetched ${prefetchedCount} entity sets from local DB`);
        }
      } catch (err) {
        console.warn('[FastQuery] Prefetch failed:', err.message);
      }
    })();
  }, [companyId, queryClient]);
}
