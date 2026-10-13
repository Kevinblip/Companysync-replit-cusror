import { useState, useEffect, useCallback, useRef } from 'react';
import { getQueueCount, getPendingItems, markItemComplete, markItemFailed, clearCompletedItems } from '@/lib/offlineQueue';

export function useOfflineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncingRef = useRef(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const updateCounts = useCallback(async () => {
    try {
      const count = await getQueueCount();
      setPendingCount(count.pending || 0);
      setFailedCount(count.failed || 0);
    } catch {}
  }, []);

  useEffect(() => {
    updateCounts();
    const interval = setInterval(updateCounts, 10000);
    return () => clearInterval(interval);
  }, [updateCounts]);

  const syncQueue = useCallback(async (base44Client) => {
    if (!navigator.onLine || syncingRef.current) return;
    const client = base44Client || window.__base44Client;
    if (!client) return;

    syncingRef.current = true;
    setIsSyncing(true);
    try {
      await clearCompletedItems();

      const items = await getPendingItems();
      for (const item of items) {
        try {
          if (item.type === 'photo_upload' && item.data?.blob) {
            await client.files.upload(item.data.blob, item.metadata?.filename);
            await markItemComplete(item.id);
          } else if (item.type === 'entity_create' && item.entity_type) {
            const entity = client.entities[item.entity_type];
            if (entity) {
              await entity.create(item.data);
              await markItemComplete(item.id);
            }
          } else if (item.type === 'entity_update' && item.entity_type && item.entity_id) {
            const entity = client.entities[item.entity_type];
            if (entity) {
              await entity.update(item.entity_id, item.data);
              await markItemComplete(item.id);
            }
          }
        } catch (err) {
          console.warn('[Offline Sync] Failed to sync item:', item.id, err);
          await markItemFailed(item.id);
        }
      }

      await updateCounts();
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [updateCounts]);

  useEffect(() => {
    if (isOnline && pendingCount > 0) {
      const timer = setTimeout(() => syncQueue(), 2000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, pendingCount, syncQueue]);

  useEffect(() => {
    if (isOnline) {
      const handleMessage = (event) => {
        if (event.data?.type === 'SYNC_OFFLINE_QUEUE') {
          syncQueue();
        }
      };

      navigator.serviceWorker?.addEventListener('message', handleMessage);
      return () => navigator.serviceWorker?.removeEventListener('message', handleMessage);
    }
  }, [isOnline, syncQueue]);

  useEffect(() => {
    if (isOnline && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        if ('sync' in registration) {
          registration.sync.register('sync-offline-queue').catch(() => {});
        }
      });
    }
  }, [isOnline]);

  return {
    isOnline,
    pendingCount,
    failedCount,
    isSyncing,
    syncQueue,
  };
}
