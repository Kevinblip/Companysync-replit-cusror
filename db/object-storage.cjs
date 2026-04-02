/**
 * Replit App Storage (GCS-backed) helper for CJS production code.
 * Uses the local Replit sidecar at http://127.0.0.1:1106 to obtain
 * signed URLs for PUT/GET/HEAD, then performs the actual operations
 * directly against Google Cloud Storage.
 *
 * Bucket layout:
 *   PUBLIC_OBJECT_SEARCH_PATHS = /replit-objstore-xxx/public
 *   All uploads go into: {bucket}/public/{filename}
 */
const SIDECAR_URL = 'http://127.0.0.1:1106';

function getBucketAndPrefix() {
  const searchPaths = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
  const firstPath = searchPaths.split(',')[0].trim();
  if (!firstPath) throw new Error('PUBLIC_OBJECT_SEARCH_PATHS not set — object storage not configured');
  const parts = firstPath.split('/').filter(Boolean);
  const bucketName = parts[0];
  const prefix = parts.slice(1).join('/');
  return { bucketName, prefix };
}

function getObjectName(filename) {
  const { prefix } = getBucketAndPrefix();
  return prefix ? `${prefix}/${filename}` : filename;
}

async function getSignedUrl(filename, method, ttlSec = 900) {
  const { bucketName } = getBucketAndPrefix();
  const objectName = getObjectName(filename);
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
  const response = await fetch(`${SIDECAR_URL}/object-storage/signed-object-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket_name: bucketName, object_name: objectName, method, expires_at: expiresAt }),
  });
  if (!response.ok) {
    const txt = await response.text().catch(() => response.status);
    throw new Error(`Sidecar signed-URL error (${response.status}): ${txt}`);
  }
  const data = await response.json();
  return data.signed_url;
}

async function uploadToObjectStorage(filename, buffer, mimeType) {
  const signedUrl = await getSignedUrl(filename, 'PUT', 900);
  const response = await fetch(signedUrl, {
    method: 'PUT',
    body: buffer,
    headers: { 'Content-Type': mimeType },
    duplex: 'half',
  });
  if (!response.ok) {
    const txt = await response.text().catch(() => response.status);
    throw new Error(`Upload to object storage failed (${response.status}): ${txt}`);
  }
  return true;
}

async function downloadFromObjectStorage(filename) {
  try {
    const signedUrl = await getSignedUrl(filename, 'GET', 900);
    const response = await fetch(signedUrl);
    if (response.status === 403 || response.status === 404) return null;
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    const buf = await response.arrayBuffer();
    return Buffer.from(buf);
  } catch (e) {
    if (e.message && (e.message.includes('not found') || e.message.includes('ECONNREFUSED'))) return null;
    throw e;
  }
}

async function objectExistsInStorage(filename) {
  try {
    const signedUrl = await getSignedUrl(filename, 'GET', 60);
    const response = await fetch(signedUrl, { method: 'HEAD' });
    return response.ok;
  } catch (e) {
    return false;
  }
}

async function isObjectStorageAvailable() {
  try {
    const paths = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
    if (!paths) return false;
    const response = await fetch(`${SIDECAR_URL}/token`, { signal: AbortSignal.timeout(2000) });
    return response.status < 500;
  } catch (e) {
    return false;
  }
}

module.exports = {
  uploadToObjectStorage,
  downloadFromObjectStorage,
  objectExistsInStorage,
  isObjectStorageAvailable,
};
