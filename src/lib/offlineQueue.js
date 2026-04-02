const DB_NAME = 'companysync-offline';
const DB_VERSION = 1;
const QUEUE_STORE = 'upload-queue';
const CACHE_STORE = 'entity-cache';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        const cache = db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        cache.createIndex('entity_type', 'entity_type', { unique: false });
        cache.createIndex('updated_at', 'updated_at', { unique: false });
      }
    };
  });
}

export async function addToQueue(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const record = {
      ...item,
      status: 'pending',
      created_at: Date.now(),
      retry_count: 0,
    };
    const request = store.add(record);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queuePhoto(photoData) {
  return addToQueue({
    type: 'photo_upload',
    data: photoData,
    metadata: {
      filename: photoData.filename || `photo_${Date.now()}.jpg`,
      company_id: photoData.company_id,
      inspection_id: photoData.inspection_id,
    }
  });
}

export async function queueEntityCreate(entityType, data) {
  return addToQueue({
    type: 'entity_create',
    entity_type: entityType,
    data,
  });
}

export async function queueEntityUpdate(entityType, id, data) {
  return addToQueue({
    type: 'entity_update',
    entity_type: entityType,
    entity_id: id,
    data,
  });
}

export async function getPendingItems() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readonly');
    const store = tx.objectStore(QUEUE_STORE);
    const index = store.index('status');
    const request = index.getAll('pending');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getQueueCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readonly');
    const store = tx.objectStore(QUEUE_STORE);
    const index = store.index('status');
    let pending = 0;
    let failed = 0;

    const pendingReq = index.getAll('pending');
    pendingReq.onsuccess = () => {
      pending = pendingReq.result.length;
      const failedReq = index.getAll('failed');
      failedReq.onsuccess = () => {
        failed = failedReq.result.length;
        resolve({ pending, failed });
      };
      failedReq.onerror = () => reject(failedReq.error);
    };
    pendingReq.onerror = () => reject(pendingReq.error);
  });
}

export async function markItemComplete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (item) {
        item.status = 'completed';
        item.completed_at = Date.now();
        store.put(item);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function markItemFailed(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (item) {
        item.retry_count = (item.retry_count || 0) + 1;
        if (item.retry_count >= 5) {
          item.status = 'failed';
        }
        store.put(item);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function cacheEntity(entityType, id, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    const store = tx.objectStore(CACHE_STORE);
    const record = {
      key: `${entityType}:${id}`,
      entity_type: entityType,
      data,
      updated_at: Date.now(),
    };
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function cacheEntityList(entityType, items) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    const store = tx.objectStore(CACHE_STORE);
    const listRecord = {
      key: `${entityType}:__list__`,
      entity_type: entityType,
      data: items,
      updated_at: Date.now(),
    };
    store.put(listRecord);
    items.forEach(item => {
      if (item.id) {
        store.put({
          key: `${entityType}:${item.id}`,
          entity_type: entityType,
          data: item,
          updated_at: Date.now(),
        });
      }
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedEntityList(entityType) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const store = tx.objectStore(CACHE_STORE);
    const request = store.get(`${entityType}:__list__`);
    request.onsuccess = () => resolve(request.result?.data || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedEntity(entityType, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readonly');
    const store = tx.objectStore(CACHE_STORE);
    const request = store.get(`${entityType}:${id}`);
    request.onsuccess = () => resolve(request.result?.data || null);
    request.onerror = () => reject(request.error);
  });
}

export async function clearCompletedItems() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE);
    const index = store.index('status');
    const request = index.openCursor('completed');
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearOldCache(maxAge = 7 * 24 * 60 * 60 * 1000) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    const store = tx.objectStore(CACHE_STORE);
    const cutoff = Date.now() - maxAge;
    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.updated_at < cutoff) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
