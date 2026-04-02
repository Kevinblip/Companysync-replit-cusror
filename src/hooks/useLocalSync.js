import { useEffect, useRef, useCallback, useState } from 'react';
import { base44 } from '@/api/base44Client';

const SYNC_INTERVAL_MS = 2 * 60 * 1000;
const ENTITY_CONFIG = [
  { type: 'leads', entity: 'Lead', sort: '-created_date', limit: 500 },
  { type: 'customers', entity: 'Customer', sort: '-created_date', limit: 500 },
  { type: 'estimates', entity: 'Estimate', sort: '-created_date', limit: 300 },
  { type: 'invoices', entity: 'Invoice', sort: '-created_date', limit: 300 },
  { type: 'payments', entity: 'Payment', sort: '-payment_date', limit: 300 },
  { type: 'projects', entity: 'Project', sort: '-created_date', limit: 200 },
  { type: 'tasks', entity: 'Task', sort: '-updated_date', limit: 300 },
  { type: 'calendar_events', entity: 'CalendarEvent', sort: '-start_time', limit: 500 },
  { type: 'communications', entity: 'Communication', sort: '-created_date', limit: 100 },
  { type: 'staff_profiles', entity: 'StaffProfile', sort: null, limit: 100 },
];

export function useLocalSync(companyId) {
  const syncIntervalRef = useRef(null);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [lastSynced, setLastSynced] = useState(null);
  const isSyncingRef = useRef(false);

  const syncAll = useCallback(async () => {
    if (!companyId || isSyncingRef.current) return;
    isSyncingRef.current = true;
    setSyncStatus('syncing');

    try {
      const entities = {};

      const results = await Promise.allSettled(
        ENTITY_CONFIG.map(async (config) => {
          try {
            const filter = { company_id: companyId };
            let records;
            if (config.sort) {
              records = await base44.entities[config.entity].filter(filter, config.sort, config.limit);
            } else {
              records = await base44.entities[config.entity].filter(filter);
            }
            return { type: config.type, records: records || [] };
          } catch (err) {
            console.warn(`[Sync] Failed to fetch ${config.type} from Base44:`, err.message);
            return { type: config.type, records: [] };
          }
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.records.length > 0) {
          entities[result.value.type] = result.value.records;
        }
      }

      if (Object.keys(entities).length > 0) {
        // Filter out staff_profiles from bulk sync to prevent duplicate creation
        const { staff_profiles, ...otherEntities } = entities;
        if (Object.keys(otherEntities).length > 0) {
          const response = await fetch('/api/local/sync/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entities: otherEntities, company_id: companyId }),
          });
          const data = await response.json();
          if (data.success) {
            const totalSynced = Object.values(data.results).reduce((sum, r) => sum + r.synced, 0);
            console.log(`[Sync] Bulk sync complete: ${totalSynced} records across ${Object.keys(data.results).length} entities`);
          }
        }
      }

      setSyncStatus('synced');
      setLastSynced(new Date());
    } catch (err) {
      console.error('[Sync] Full sync failed:', err.message);
      setSyncStatus('error');
    } finally {
      isSyncingRef.current = false;
    }
  }, [companyId]);

  const syncEntity = useCallback(async (entityType, entityName) => {
    if (!companyId) return;
    try {
      const filter = { company_id: companyId };
      const config = ENTITY_CONFIG.find(c => c.type === entityType);
      let records;
      if (config?.sort) {
        records = await base44.entities[entityName].filter(filter, config.sort, config?.limit || 200);
      } else {
        records = await base44.entities[entityName].filter(filter);
      }

      if (records && records.length > 0) {
        await fetch('/api/local/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_type: entityType, records, company_id: companyId }),
        });
        console.log(`[Sync] ${entityType}: ${records.length} records synced`);
      }
    } catch (err) {
      console.error(`[Sync] ${entityType} sync failed:`, err.message);
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;

    syncAll();

    syncIntervalRef.current = setInterval(syncAll, SYNC_INTERVAL_MS);

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [companyId, syncAll]);

  return { syncStatus, lastSynced, syncAll, syncEntity };
}
