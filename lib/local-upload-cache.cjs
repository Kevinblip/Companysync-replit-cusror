const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
// Keep this aligned with vite.config.js: only UUID-named root photos are
// disposable cache files. UUID-named PDFs/XML/ESX/HTML files may be tracked
// fixtures or generated documents and must not be swept as photo cache.
const UUID_ROOT_PHOTO_NAME = /^[0-9a-f]{8}-[0-9a-f-]{27,}\.(?:jpe?g|png|webp)$/i;
const registrations = new Map();
let cleanupTimer = null;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getCacheLimits() {
  return {
    maxBytes: positiveNumber(process.env.LOCAL_UPLOAD_CACHE_MAX_MB, 512) * 1024 * 1024,
    maxAgeMs: positiveNumber(process.env.LOCAL_UPLOAD_CACHE_MAX_AGE_DAYS, 7) * 24 * 60 * 60 * 1000,
  };
}

function directFiles(directory, filter) {
  if (!directory || !fs.existsSync(directory)) return [];
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch {
    return [];
  }

  const files = [];
  for (const name of names) {
    if (filter && !filter(name)) continue;
    const filePath = path.join(directory, name);
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) files.push({ filePath, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {
      // A concurrent request may remove a file between readdir and stat.
    }
  }
  return files;
}

function cleanupLocalUploadCache(cache) {
  const now = Date.now();
  const files = [
    ...directFiles(cache.uploadsDir),
    ...directFiles(cache.publicRoot, name => UUID_ROOT_PHOTO_NAME.test(name)),
  ];

  let totalBytes = 0;
  const retained = [];
  for (const file of files) {
    if (now - file.mtimeMs > cache.maxAgeMs) {
      try { fs.unlinkSync(file.filePath); } catch {}
      continue;
    }
    totalBytes += file.size;
    retained.push(file);
  }

  if (totalBytes <= cache.maxBytes) return;
  retained.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const file of retained) {
    if (totalBytes <= cache.maxBytes) break;
    try {
      fs.unlinkSync(file.filePath);
      totalBytes -= file.size;
    } catch {}
  }
}

function isManagedPath(cache, filePath) {
  const resolved = path.resolve(filePath);
  const uploadsDir = cache.uploadsDir && path.resolve(cache.uploadsDir);
  const publicRoot = cache.publicRoot && path.resolve(cache.publicRoot);
  if (uploadsDir && path.dirname(resolved) === uploadsDir) return true;
  return publicRoot
    && path.dirname(resolved) === publicRoot
    && UUID_ROOT_PHOTO_NAME.test(path.basename(resolved));
}

function registerLocalUploadCache({ uploadsDir, publicRoot, maxBytes, maxAgeMs } = {}) {
  const limits = getCacheLimits();
  const cache = {
    uploadsDir: uploadsDir ? path.resolve(uploadsDir) : null,
    publicRoot: publicRoot ? path.resolve(publicRoot) : null,
    maxBytes: maxBytes || limits.maxBytes,
    maxAgeMs: maxAgeMs || limits.maxAgeMs,
  };
  const key = `${cache.uploadsDir || ''}|${cache.publicRoot || ''}`;
  if (registrations.has(key)) return registrations.get(key);

  registrations.set(key, cache);
  cleanupLocalUploadCache(cache);
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      for (const registeredCache of registrations.values()) {
        cleanupLocalUploadCache(registeredCache);
      }
    }, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref?.();
  }
  return cache;
}

function writeLocalUploadCache(cache, filePath, data) {
  if (!cache || !isManagedPath(cache, filePath) || !Buffer.isBuffer(data) || data.length > cache.maxBytes) {
    return false;
  }
  try {
    const directory = path.dirname(filePath);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
    cleanupLocalUploadCache(cache);
    fs.writeFileSync(filePath, data);
    cleanupLocalUploadCache(cache);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  cleanupLocalUploadCache,
  registerLocalUploadCache,
  writeLocalUploadCache,
};