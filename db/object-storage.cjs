/**
 * Replit App Storage (GCS-backed) helper for CJS production code.
 *
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
  const prefix = parts.slice(1).join('/'); // e.g. 'public'
  return { bucketName, prefix };
}

function getObjectName(filename) {
  const { prefix } = getBucketAndPrefix();
  return prefix ? `${prefix}/${filename}` : filename;
}

async function getSignedUrlForObject(bucketName, objectName, method, ttlSec = 900, signal) {
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
  const response = await fetch(`${SIDECAR_URL}/object-storage/signed-object-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket_name: bucketName, object_name: objectName, method, expires_at: expiresAt }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const txt = await response.text().catch(() => response.status);
    throw new Error(`Sidecar signed-URL error (${response.status}): ${txt}`);
  }
  const data = await response.json();
  return data.signed_url;
}

async function getSignedUrl(filename, method, ttlSec = 900) {
  const { bucketName } = getBucketAndPrefix();
  const objectName = getObjectName(filename);
  return getSignedUrlForObject(bucketName, objectName, method, ttlSec);
}

// ─── Private object storage ────────────────────────────────────────────────
// Writes under PRIVATE_OBJECT_DIR (e.g. /{bucket}/.private) instead of the
// public prefix. Private objects are NOT served by the unauthenticated
// /uploads/* route, so this is safe for full-company data dumps (backups).
function getPrivateBucketAndPrefix() {
  const dir = process.env.PRIVATE_OBJECT_DIR || '';
  if (!dir) throw new Error('PRIVATE_OBJECT_DIR not set — private object storage not configured');
  const parts = dir.split('/').filter(Boolean);
  const bucketName = parts[0];
  const prefix = parts.slice(1).join('/'); // e.g. '.private'
  return { bucketName, prefix };
}

/**
 * Upload a Buffer to PRIVATE object storage.
 * @param {string} objectPath - path relative to the private prefix, e.g. "backups/<companyId>/<backupId>.json"
 * @param {Buffer} buffer
 * @param {string} contentType
 * @returns {Promise<string>} the full storage key (object name) that can be passed to downloadPrivateObject
 */
async function uploadPrivateObject(objectPath, buffer, contentType = 'application/json') {
  const { bucketName, prefix } = getPrivateBucketAndPrefix();
  const objectName = prefix ? `${prefix}/${objectPath}` : objectPath;
  const signedUrl = await getSignedUrlForObject(bucketName, objectName, 'PUT', 900);
  const response = await fetch(signedUrl, {
    method: 'PUT',
    body: buffer,
    headers: { 'Content-Type': contentType },
    duplex: 'half',
  });
  if (!response.ok) {
    const txt = await response.text().catch(() => response.status);
    throw new Error(`Private upload failed (${response.status}): ${txt}`);
  }
  return objectName;
}

/**
 * Download a file from PRIVATE object storage. Returns Buffer or null if not found.
 * Accepts either a full storage key (already prefixed) or a path relative to the private prefix.
 * @param {string} objectPathOrKey
 */
async function downloadPrivateObject(objectPathOrKey, options = {}) {
  const { bucketName, prefix } = getPrivateBucketAndPrefix();
  const objectName = (prefix && !objectPathOrKey.startsWith(prefix + '/')) ? `${prefix}/${objectPathOrKey}` : objectPathOrKey;
  const bounded = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0;
  const controller = bounded ? new AbortController() : null;
  const timeout = bounded ? setTimeout(() => controller.abort(), options.timeoutMs || 15000) : null;
  timeout?.unref?.();
  try {
    const signedUrl = await getSignedUrlForObject(bucketName, objectName, 'GET', 900, controller?.signal);
    const response = await fetch(signedUrl, controller ? { signal: controller.signal } : undefined);
    if (response.status === 403 || response.status === 404) return null;
    if (!response.ok) throw new Error(`Private download failed (${response.status})`);
    if (bounded) {
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
        await response.body?.cancel();
        const error = new Error(`Private object exceeds the ${options.maxBytes} byte download limit.`);
        error.statusCode = 413;
        throw error;
      }
      if (response.body) {
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > options.maxBytes) {
            await reader.cancel().catch(() => {});
            const error = new Error(`Private object exceeds the ${options.maxBytes} byte download limit.`);
            error.statusCode = 413;
            throw error;
          }
          chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks, total);
      }
    }
    const buf = await response.arrayBuffer();
    if (bounded && buf.byteLength > options.maxBytes) {
      const error = new Error(`Private object exceeds the ${options.maxBytes} byte download limit.`);
      error.statusCode = 413;
      throw error;
    }
    return Buffer.from(buf);
  } catch (e) {
    if (controller?.signal.aborted) {
      const error = new Error('Private object download timed out.');
      error.statusCode = 504;
      throw error;
    }
    if (e.message && (e.message.includes('not found') || e.message.includes('ECONNREFUSED'))) return null;
    throw e;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Upload a Buffer to object storage under the public prefix.
 * @param {string} filename - just the filename e.g. "uuid.jpg"
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
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

/**
 * Download a file from object storage. Returns Buffer or null if not found.
 * @param {string} filename
 */
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

/**
 * Download a public object with a hard byte and time limit. The caller must
 * pass a storage filename, never a URL or path supplied by an end user.
 */
async function downloadFromObjectStorageBounded(filename, { maxBytes, timeoutMs = 15000 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('A positive maxBytes limit is required for bounded object downloads.');
  }
  if (typeof filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(filename) ||
      filename === '.' || filename === '..') {
    throw new TypeError('Object storage filename is invalid.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const { bucketName } = getBucketAndPrefix();
    const signedUrl = await getSignedUrlForObject(bucketName, getObjectName(filename), 'GET', 900, controller.signal);
    const response = await fetch(signedUrl, { signal: controller.signal });
    if (response.status === 403 || response.status === 404) return null;
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body?.cancel();
      const error = new Error(`Stored photo exceeds the ${maxBytes} byte download limit.`);
      error.statusCode = 413;
      throw error;
    }
    if (!response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) {
        const error = new Error(`Stored photo exceeds the ${maxBytes} byte download limit.`);
        error.statusCode = 413;
        throw error;
      }
      return buffer;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        const error = new Error(`Stored photo exceeds the ${maxBytes} byte download limit.`);
        error.statusCode = 413;
        throw error;
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error('Object storage photo download timed out.');
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    if (error.message && (error.message.includes('not found') || error.message.includes('ECONNREFUSED'))) return null;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check if a file exists in object storage.
 * @param {string} filename
 */
async function objectExistsInStorage(filename) {
  try {
    const signedUrl = await getSignedUrl(filename, 'GET', 60);
    const response = await fetch(signedUrl, { method: 'HEAD' });
    return response.ok;
  } catch (e) {
    return false;
  }
}

/**
 * Check whether the object storage sidecar is reachable.
 */
async function isObjectStorageAvailable() {
  try {
    const paths = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
    if (!paths) return false;
    // Any HTTP response (even 405 Method Not Allowed) means the sidecar is up
    const response = await fetch(`${SIDECAR_URL}/token`, { signal: AbortSignal.timeout(2000) });
    return response.status < 500;
  } catch (e) {
    return false;
  }
}

module.exports = {
  getSignedUrl,
  uploadToObjectStorage,
  downloadFromObjectStorage,
  downloadFromObjectStorageBounded,
  objectExistsInStorage,
  isObjectStorageAvailable,
  uploadPrivateObject,
  downloadPrivateObject,
};
