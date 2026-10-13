import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useDashboardPrefetch(companyId) {
  const queryClient = useQueryClient();
  const prefetched = useRef(false);

  useEffect(() => {
    if (!companyId || prefetched.current) return;
    prefetched.current = true;

    // limits are intentionally conservative — prefetch is a warmup, not a full load.
    // Heavy/unbounded collections (communications, payments) use a smaller cap so
    // the initial burst doesn't flood the connection pool on login.
    const ENTITY_MAP = [
      { key: ['invoices', companyId],        type: 'invoices',        limit: 200 },
      { key: ['customers', companyId],       type: 'customers',       limit: 200 },
      { key: ['estimates', companyId],       type: 'estimates',       limit: 200 },
      { key: ['projects', companyId],        type: 'projects',        limit: 100 },
      { key: ['leads', companyId],           type: 'leads',           limit: 200 },
      { key: ['tasks', companyId],           type: 'tasks',           limit: 200 },
      { key: ['payments', companyId],        type: 'payments',        limit: 100 },
      { key: ['communications', companyId],  type: 'communications',  limit: 50  },
      { key: ['staff-profiles', companyId],  type: 'staff_profiles',  limit: 100 },
    ];

    (async () => {
      try {
        const results = await Promise.allSettled(
          ENTITY_MAP.map(async ({ key, type, limit }) => {
            const existing = queryClient.getQueryData(key);
            if (existing && existing.length > 0) return null;

            const response = await fetch(
              `/api/local/entities/${type}?company_id=${encodeURIComponent(companyId)}&limit=${limit}`
            );
            if (!response.ok) return null;
            const data = await response.json();
            if (!data.records || data.records.length === 0) return null;

            const mapped = data.records.map(r => ({
              ...r.data,
              id: r.base44_id || r.id,
              company_id: r.company_id,
              user_email: r.user_email,
              full_name: r.full_name,
              avatar_url: r.avatar_url,
              is_administrator: r.is_administrator,
              is_active: r.is_active,
              commission_rate: r.commission_rate,
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
            })).map(rec => {
              // Don't let missing top-level columns (undefined) clobber values
              // that exist in the data JSONB — mirrors the SDK's flattening rule.
              Object.keys(rec).forEach(k => { if (rec[k] === undefined) delete rec[k]; });
              return rec;
            });

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
