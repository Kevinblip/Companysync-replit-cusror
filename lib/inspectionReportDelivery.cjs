'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const objectStorage = require('../db/object-storage.cjs');

const REPORT_ENTITY = 'InspectionReportFile';
const ACCESS_ENTITY = 'InspectionReportAccess';
const REPORT_EMAIL_ENTITY = 'InspectionReportEmail';
// Private inspection-report PDFs may be up to 48 MiB. Both declared and
// streamed request sizes are checked against this limit.
const MAX_PDF_BYTES = 48 * 1024 * 1024;
// Match the existing upload ceiling so a valid stored original is not excluded.
const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
const MAX_PHOTO_JPEG_BYTES = 2 * 1024 * 1024;
const LINK_TTL_MS = 72 * 60 * 60 * 1000;

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validatePdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) {
    throw httpError(400, 'The inspection report PDF is empty or invalid.');
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw httpError(413, 'Inspection report PDFs must be 48 MiB or smaller.');
  }
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw httpError(400, 'The uploaded file is not a valid PDF.');
  }
  const tail = buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1');
  if (!tail.includes('%%EOF')) {
    throw httpError(400, 'The uploaded PDF is incomplete.');
  }
  return buffer;
}

function readPdfBody(req) {
  const contentType = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/pdf') {
    return Promise.reject(httpError(415, 'Upload the report as application/pdf.'));
  }
  const contentLengthHeader = req.headers?.['content-length'];
  const declaredLength = contentLengthHeader === undefined ? null : Number(contentLengthHeader);
  if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) {
    return Promise.reject(httpError(400, 'The report upload has an invalid Content-Length.'));
  }
  if (declaredLength !== null && declaredLength > MAX_PDF_BYTES) {
    return Promise.reject(httpError(413, 'Inspection report PDFs must be 48 MiB or smaller.'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_PDF_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        req.pause?.();
        reject(httpError(413, 'Inspection report PDFs must be 48 MiB or smaller.'));
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (declaredLength !== null && total !== declaredLength) {
        return reject(httpError(400, 'The report upload size did not match its Content-Length.'));
      }
      try {
        resolve(validatePdfBuffer(Buffer.concat(chunks, total)));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function getInspectionJob(pool, jobId) {
  const result = await pool.query(
    `SELECT id, company_id, data
     FROM generic_entities
     WHERE id = $1 AND entity_type = 'InspectionJob'
     LIMIT 1`,
    [jobId],
  );
  const row = result.rows[0];
  if (!row) throw httpError(404, 'Inspection job not found.');
  const data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
  const companyId = row.company_id || data.company_id;
  if (!companyId) throw httpError(403, 'This inspection job has no owning company.');
  return { ...row, data, companyId };
}

async function authorizeInspectionJob(pool, caller, jobId) {
  if (!caller?.email) throw httpError(401, 'Authentication required.');
  const job = await getInspectionJob(pool, jobId);
  if (caller.is_super_admin === true) return job;
  const membership = await pool.query(
    `SELECT 1
     FROM companies c
     WHERE c.id = $2
       AND (
         LOWER(COALESCE(c.created_by, '')) = LOWER($1)
         OR EXISTS (
           SELECT 1 FROM staff_profiles sp
           WHERE sp.company_id = c.id
             AND LOWER(COALESCE(NULLIF(sp.user_email, ''), sp.email)) = LOWER($1)
             AND COALESCE(sp.is_active, true) = true
         )
       )
     LIMIT 1`,
    [caller.email, job.companyId],
  );
  if (!membership.rowCount) throw httpError(403, 'You do not have access to this inspection report.');
  return job;
}

async function uploadInspectionReport({ req, pool, caller, jobId, storage = objectStorage }) {
  if (!jobId) throw httpError(400, 'Inspection job is required.');
  const job = await authorizeInspectionJob(pool, caller, jobId);
  const pdf = await readPdfBody(req);
  const reportId = crypto.randomUUID();
  const storageKey = `inspection-reports/${job.companyId}/${job.id}/${reportId}.pdf`;
  await storage.uploadPrivateObject(storageKey, pdf, 'application/pdf');
  const now = new Date().toISOString();
  const data = {
    inspection_job_id: job.id,
    storage_key: storageKey,
    size_bytes: pdf.length,
    created_by: caller.email,
    created_at: now,
  };
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [reportId, REPORT_ENTITY, job.companyId, JSON.stringify(data)],
  );
  return { reportId, sizeBytes: pdf.length };
}

async function getOwnedReport(pool, reportId, job) {
  const result = await pool.query(
    `SELECT id, company_id, data
     FROM generic_entities
     WHERE id = $1 AND entity_type = $2 AND company_id = $3
     LIMIT 1`,
    [reportId, REPORT_ENTITY, job.companyId],
  );
  const row = result.rows[0];
  if (!row) throw httpError(404, 'Inspection report upload not found.');
  const data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
  if (data.inspection_job_id !== job.id || !data.storage_key ||
      !data.storage_key.startsWith(`inspection-reports/${job.companyId}/${job.id}/`)) {
    throw httpError(403, 'The uploaded PDF does not belong to this inspection job.');
  }
  return { ...row, data };
}

function resolveUploadFilename(fileUrl) {
  if (typeof fileUrl !== 'string' || !fileUrl.trim()) {
    throw httpError(404, 'Inspection photo is unavailable.');
  }
  let pathname;
  const value = fileUrl.trim();
  try {
    if (/^https?:\/\//i.test(value)) pathname = new URL(value).pathname;
    else pathname = value.split(/[?#]/, 1)[0];
  } catch {
    throw httpError(404, 'Inspection photo is unavailable.');
  }
  // Production's /uploads handler also serves historical object-storage URLs
  // by their final filename. Never fetch the stored URL itself.
  const match = pathname.match(/^\/uploads\/([^/]+)$/) ||
    pathname.match(/^\/replit-objstore-[A-Za-z0-9-]+\/[^/]+\/(?:[^/]+\/)*([^/]+)$/) ||
    pathname.match(/^\/([a-f0-9-]{36}\.(?:jpe?g|png|webp|heic))$/i);
  if (!match) throw httpError(404, 'Inspection photo is unavailable.');
  let filename;
  try {
    filename = decodeURIComponent(match[1]);
  } catch {
    throw httpError(404, 'Inspection photo is unavailable.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(filename) || filename === '.' || filename === '..') {
    throw httpError(404, 'Inspection photo is unavailable.');
  }
  return filename;
}

async function readStoredPhotoBounded(pool, filename, storage, { diskDirs } = {}) {
  let storageError;
  try {
    const original = await storage.downloadFromObjectStorageBounded(filename, {
      maxBytes: MAX_PHOTO_BYTES,
      timeoutMs: 15000,
    });
    if (original) return original;
  } catch (error) {
    if (error.statusCode === 413) throw error;
    storageError = error;
  }

  // file_uploads is the existing upload fallback when object storage is down.
  // Return the bytea only if it fits, rather than materializing a huge row.
  let databaseError;
  try {
    const found = await pool.query(
      `SELECT octet_length(file_data) AS byte_count,
              CASE WHEN octet_length(file_data) <= $2 THEN file_data ELSE NULL END AS file_data
       FROM file_uploads WHERE id = $1 AND file_data IS NOT NULL LIMIT 1`,
      [filename, MAX_PHOTO_BYTES],
    );
    if (found.rows[0]) {
      if (Number(found.rows[0].byte_count) > MAX_PHOTO_BYTES) {
        throw httpError(413, 'Stored inspection photo exceeds the 50 MiB source limit.');
      }
      if (found.rows[0].file_data) return found.rows[0].file_data;
    }
  } catch (error) {
    if (error.statusCode === 413) throw error;
    databaseError = error;
  }

  const candidates = diskDirs || [
    path.join(process.cwd(), 'public', 'uploads'),
    path.join(process.cwd(), 'public'),
    path.join(process.cwd(), 'dist'),
    process.cwd(),
    path.join(__dirname, '..', 'db', 'public', 'uploads'),
  ];
  for (const dir of candidates) {
    const filePath = path.join(dir, filename);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_PHOTO_BYTES) throw httpError(413, 'Stored inspection photo exceeds the 50 MiB source limit.');
      const original = await fs.readFile(filePath);
      if (original.length > MAX_PHOTO_BYTES) throw httpError(413, 'Stored inspection photo exceeds the 50 MiB source limit.');
      return original;
    } catch (error) {
      if (error.statusCode === 413) throw error;
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (storageError || databaseError) throw httpError(503, 'Inspection photo storage is temporarily unavailable. Try again later.');
  return null;
}

function readSafeImageDimensions(buffer) {
  let dimensions = null;
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    dimensions = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } else if (buffer.length >= 10 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) {
    dimensions = { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  } else if (buffer.length >= 30 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    const chunk = buffer.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X') {
      dimensions = {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    } else if (chunk === 'VP8 ' && buffer.length >= 30) {
      dimensions = {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    } else if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
      dimensions = {
        width: 1 + buffer[21] + ((buffer[22] & 0x3f) << 8),
        height: 1 + (buffer[22] >> 6) + (buffer[23] << 2) + ((buffer[24] & 0x0f) << 10),
      };
    }
  } else if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 4 <= buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      while (buffer[offset] === 0xff) offset++;
      const marker = buffer[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
      if (sofMarkers.has(marker) && segmentLength >= 7) {
        dimensions = {
          height: buffer.readUInt16BE(offset + 3),
          width: buffer.readUInt16BE(offset + 5),
        };
        break;
      }
      offset += segmentLength;
    }
  }
  if (!dimensions || !dimensions.width || !dimensions.height ||
      dimensions.width > 30000 || dimensions.height > 30000 ||
      dimensions.width * dimensions.height > 50000000) {
    throw httpError(415, 'The stored inspection photo has invalid or unsupported dimensions.');
  }
  return dimensions;
}

async function getInspectionJobPhoto({ pool, caller, jobId, mediaId, photoCount, storage = objectStorage, diskDirs }) {
  if (!jobId || !mediaId) throw httpError(400, 'Inspection job and photo are required.');
  const job = await authorizeInspectionJob(pool, caller, jobId);
  const result = await pool.query(
    `SELECT id, company_id, data
     FROM generic_entities
     WHERE id = $1 AND entity_type = 'JobMedia' AND company_id = $2
     LIMIT 1`,
    [mediaId, job.companyId],
  );
  const row = result.rows[0];
  if (!row) throw httpError(404, 'Inspection photo not found.');
  const data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
  if (String(row.company_id) !== String(job.companyId) ||
      String(data.company_id || row.company_id) !== String(job.companyId) ||
      String(data.related_entity_id || '') !== String(job.id) ||
      String(data.file_type || '').toLowerCase() !== 'photo') {
    throw httpError(404, 'Inspection photo not found.');
  }
  const filename = resolveUploadFilename(data.file_url);
  const original = await readStoredPhotoBounded(pool, filename, storage, { diskDirs });
  if (!original) throw httpError(404, 'Inspection photo not found.');
  const dimensions = readSafeImageDimensions(original);
  let loadImage;
  let createCanvas;
  try {
    ({ loadImage, createCanvas } = require('@napi-rs/canvas'));
  } catch {
    throw new Error('Inspection photo processing is unavailable.');
  }
  let image;
  try {
    image = await loadImage(original);
  } catch {
    throw httpError(415, 'The stored inspection photo is not a supported image.');
  }
  // Decoders may apply a camera's EXIF orientation, swapping portrait width
  // and height even though the JPEG header still reports the stored axes.
  const sameAxes = image.width === dimensions.width && image.height === dimensions.height;
  const rotatedAxes = image.width === dimensions.height && image.height === dimensions.width;
  if (!sameAxes && !rotatedAxes) {
    throw httpError(415, 'The stored inspection photo has invalid dimensions.');
  }
  // Leave ~12 MiB for PDF text, metadata, logos and upload overhead. A 179
  // photo report gets about 210 KiB per photo, rather than 179 * 2 MiB.
  const count = Number(photoCount);
  const targetBytes = Number.isInteger(count) && count > 0 && count <= 500
    ? Math.min(MAX_PHOTO_JPEG_BYTES, Math.floor(36 * 1024 * 1024 / count))
    : MAX_PHOTO_JPEG_BYTES;
  const encodeAt = (maxPx, quality) => {
    const scale = Math.min(1, maxPx / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toBuffer('image/jpeg', quality);
  };
  let jpeg = encodeAt(1200, 72);
  if (jpeg.length > targetBytes) jpeg = encodeAt(1200, 58);
  if (jpeg.length > targetBytes) {
    const maxPx = Math.max(840, Math.min(1080, Math.floor(1200 * Math.sqrt(targetBytes / jpeg.length) * 0.92)));
    jpeg = encodeAt(maxPx, 58);
  }
  if (jpeg.length > targetBytes) jpeg = encodeAt(840, 42);
  if (!jpeg.length || jpeg.length > targetBytes) {
    throw httpError(413, 'This photo cannot fit the report image budget without losing legibility. No report was sent.');
  }
  return jpeg;
}

function getSigningSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('Inspection report links are unavailable: session signing is not configured.');
  return secret;
}

function makeSignedAccessToken({ accessId, expiresAt, companyId, jobId, reportId }, secret = getSigningSecret()) {
  const expiry = String(expiresAt);
  const scope = `${accessId}.${expiry}.${companyId}.${jobId}.${reportId}`;
  const signature = crypto.createHmac('sha256', secret).update(scope).digest('hex');
  return `${accessId}.${expiry}.${signature}`;
}

function parseSignedAccessToken(token) {
  const match = String(token || '').match(/^([0-9a-f-]{36})\.(\d{13})\.([0-9a-f]{64})$/i);
  if (!match) throw httpError(404, 'This report link is invalid or expired.');
  return { accessId: match[1], expiry: Number(match[2]), signature: match[3].toLowerCase() };
}

async function createRecipientReportLink({ pool, report, job, recipientEmail, origin }) {
  const expiresAt = Date.now() + LINK_TTL_MS;
  const accessId = crypto.randomUUID();
  const recipient = String(recipientEmail || '').trim().toLowerCase();
  if (!recipient) throw httpError(400, 'A recipient email is required for a report link.');
  const scope = {
    companyId: job.companyId,
    jobId: job.id,
    reportId: report.id,
  };
  const token = makeSignedAccessToken({ accessId, expiresAt, ...scope });
  const data = {
    ...scope,
    storage_key: report.data.storage_key,
    recipient_email: recipient,
    expires_at: new Date(expiresAt).toISOString(),
    token_hash: crypto.createHash('sha256').update(token).digest('hex'),
    revoked: false,
  };
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [accessId, ACCESS_ENTITY, job.companyId, JSON.stringify(data)],
  );
  return {
    accessId,
    url: `${origin}/api/inspection-reports/download?token=${encodeURIComponent(token)}`,
  };
}

async function revokeRecipientReportLink(pool, accessId, companyId) {
  await pool.query(
    `UPDATE generic_entities
     SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{revoked}', 'true'::jsonb),
         updated_date = NOW()
     WHERE id = $1 AND entity_type = $2 AND company_id = $3`,
    [accessId, ACCESS_ENTITY, companyId],
  );
}

async function revokeInspectionReportLinks({ params = {}, pool, caller }) {
  const { inspectionJobId } = params;
  const accessIds = Array.isArray(params.accessIds)
    ? [...new Set(params.accessIds.map((value) => String(value || '').trim()).filter(Boolean))]
    : [];
  if (!inspectionJobId || !accessIds.length || accessIds.length > 25 ||
      accessIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
    throw httpError(400, 'A valid inspection job and report link list are required.');
  }
  const job = await authorizeInspectionJob(pool, caller, inspectionJobId);
  let revokedCount = 0;
  for (const accessId of accessIds) {
    const result = await pool.query(
      `UPDATE generic_entities
       SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{revoked}', 'true'::jsonb),
           updated_date = NOW()
       WHERE id = $1
         AND entity_type = $2
         AND company_id = $3
         AND data->>'jobId' = $4
         AND COALESCE(data->>'revoked', 'false') <> 'true'`,
      [accessId, ACCESS_ENTITY, job.companyId, job.id],
    );
    revokedCount += result.rowCount || 0;
  }
  return { success: true, revoked_count: revokedCount };
}

function recipientSendId(reportId, recipientEmail) {
  const digest = crypto.createHash('sha256').update(`${reportId}\n${recipientEmail.toLowerCase()}`).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

async function claimRecipientSend(pool, { report, job, recipientEmail }) {
  const id = recipientSendId(report.id, recipientEmail);
  const initial = {
    report_id: report.id,
    inspection_job_id: job.id,
    recipient_email: recipientEmail.toLowerCase(),
    status: 'pending',
  };
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (id, entity_type) DO NOTHING`,
    [id, REPORT_EMAIL_ENTITY, job.companyId, JSON.stringify(initial)],
  );
  const claimToken = crypto.randomUUID();
  const claim = await pool.query(
    `UPDATE generic_entities
     SET data = COALESCE(data, '{}'::jsonb) || $4::jsonb, updated_date = NOW()
     WHERE id = $1 AND entity_type = $2 AND company_id = $3
       AND data->>'status' IS DISTINCT FROM 'submitted'
        -- An expired lease is NOT proof that the provider did not accept mail.
        -- Only an explicit, recorded rejection can make the claim retryable.
        AND data->>'status' IS DISTINCT FROM 'sending'
     RETURNING id, data`,
    [id, REPORT_EMAIL_ENTITY, job.companyId, JSON.stringify({
      status: 'sending',
      claim_token: claimToken,
      lease_until: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    })],
  );
  if (claim.rows?.[0]) return { id, claimToken, data: claim.rows[0].data };
  const existing = await pool.query(
    `SELECT id, data FROM generic_entities
     WHERE id = $1 AND entity_type = $2 AND company_id = $3 LIMIT 1`,
    [id, REPORT_EMAIL_ENTITY, job.companyId],
  );
  const data = typeof existing.rows?.[0]?.data === 'string'
    ? JSON.parse(existing.rows[0].data)
    : (existing.rows?.[0]?.data || {});
  return { id, data, claimed: false };
}

async function finishRecipientSend(pool, { id, job, claimToken, status, result, error }) {
  const saved = await pool.query(
    `UPDATE generic_entities
     SET data = COALESCE(data, '{}'::jsonb) || $4::jsonb, updated_date = NOW()
     WHERE id = $1 AND entity_type = $2 AND company_id = $3
       AND data->>'claim_token' = $5`,
    [id, REPORT_EMAIL_ENTITY, job.companyId, JSON.stringify({
      status,
      lease_until: null,
      ...(result ? { result } : {}),
      ...(error ? { error: String(error).slice(0, 500) } : {}),
    }), claimToken],
  );
  if (saved.rowCount !== 1) throw new Error('Report email submission state could not be recorded.');
}

function getRequestOrigin(req) {
  const configured = process.env.VITE_REPLIT_APP_URL || process.env.PUBLIC_APP_URL;
  if (configured) {
    try {
      const parsed = new URL(configured);
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
          !parsed.username && !parsed.password) return parsed.origin;
    } catch {}
  }
  if (process.env.REPLIT_DEPLOYMENT !== '1' && process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
  if (!host || /[\s\r\n/\\?#@]/.test(host)) {
    throw new Error('Cannot create an inspection report link without the request host.');
  }
  const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const protocol = forwardedProto === 'http' || forwardedProto === 'https'
    ? forwardedProto
    : (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? 'http' : 'https');
  let parsed;
  try {
    parsed = new URL(`${protocol}://${host}`);
  } catch {
    throw new Error('Cannot create an inspection report link from an invalid request host.');
  }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Cannot create an inspection report link from an invalid request host.');
  }
  return parsed.origin;
}

async function loadAccessForDownload(pool, token, secret = getSigningSecret()) {
  const parsed = parseSignedAccessToken(token);
  if (parsed.expiry <= Date.now()) throw httpError(404, 'This report link is invalid or expired.');
  const result = await pool.query(
    `SELECT id, company_id, data
     FROM generic_entities
     WHERE id = $1 AND entity_type = $2
     LIMIT 1`,
    [parsed.accessId, ACCESS_ENTITY],
  );
  const access = result.rows[0];
  if (!access) throw httpError(404, 'This report link is invalid or expired.');
  const data = typeof access.data === 'string' ? JSON.parse(access.data) : (access.data || {});
  const expiresAt = Date.parse(data.expires_at || '');
  if (String(access.company_id) !== String(data.companyId) ||
      data.revoked === true || !Number.isFinite(expiresAt) || expiresAt !== parsed.expiry ||
      expiresAt <= Date.now() || !data.companyId || !data.jobId || !data.reportId || !data.storage_key) {
    throw httpError(404, 'This report link is invalid or expired.');
  }
  const expected = makeSignedAccessToken({
    accessId: access.id,
    expiresAt: parsed.expiry,
    companyId: data.companyId,
    jobId: data.jobId,
    reportId: data.reportId,
  }, secret);
  const signatureOk = crypto.timingSafeEqual(
    Buffer.from(parsed.signature, 'hex'),
    Buffer.from(expected.slice(expected.lastIndexOf('.') + 1), 'hex'),
  );
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const storedHash = String(data.token_hash || '');
  const hashOk = /^[0-9a-f]{64}$/i.test(storedHash) &&
    crypto.timingSafeEqual(Buffer.from(tokenHash, 'hex'), Buffer.from(storedHash, 'hex'));
  if (!signatureOk || !hashOk) throw httpError(404, 'This report link is invalid or expired.');

  const report = await pool.query(
    `SELECT id, company_id, data
     FROM generic_entities
     WHERE id = $1 AND entity_type = $2 AND company_id = $3
     LIMIT 1`,
    [data.reportId, REPORT_ENTITY, data.companyId],
  );
  const reportRow = report.rows[0];
  if (!reportRow) throw httpError(404, 'This report link is invalid or expired.');
  const reportData = typeof reportRow.data === 'string' ? JSON.parse(reportRow.data) : (reportRow.data || {});
  if (reportData.inspection_job_id !== data.jobId ||
      reportData.storage_key !== data.storage_key ||
      !data.storage_key.startsWith(`inspection-reports/${data.companyId}/${data.jobId}/`)) {
    throw httpError(404, 'This report link is invalid or expired.');
  }
  const job = await pool.query(
    `SELECT company_id, data
     FROM generic_entities
     WHERE id = $1 AND entity_type = 'InspectionJob'
     LIMIT 1`,
    [data.jobId],
  );
  const jobRow = job.rows[0];
  const jobData = typeof jobRow?.data === 'string' ? JSON.parse(jobRow.data) : (jobRow?.data || {});
  if (!jobRow || String(jobRow.company_id || jobData.company_id) !== String(data.companyId)) {
    throw httpError(404, 'This report link is invalid or expired.');
  }
  return { access, accessData: data, report: reportRow, reportData };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function inspectionReportEmailHtml({ recipientLabel, companyName, companyPhone, companyEmail, clientName, address, claimNumber, reportUrl }) {
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;border-radius:12px;overflow:hidden">
  <div style="background:#1e40af;padding:28px 32px;color:white">
    <h1 style="margin:0;font-size:22px">Inspection Report</h1>
    <p style="margin:8px 0 0;opacity:0.85;font-size:14px">${escapeHtml(companyName)}</p>
  </div>
  <div style="padding:28px 32px;background:white">
    <p style="font-size:16px;color:#1f2937">Hi ${escapeHtml(recipientLabel)},</p>
    <p style="color:#374151">Your inspection report is ready to download securely.</p>
    <div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:8px;padding:20px;margin:20px 0">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:140px">Client</td><td style="padding:6px 0;font-weight:600;color:#111827">${escapeHtml(clientName)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Address</td><td style="padding:6px 0;font-weight:600;color:#111827">${escapeHtml(address)}</td></tr>
        ${claimNumber ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Claim #</td><td style="padding:6px 0;color:#111827">${escapeHtml(claimNumber)}</td></tr>` : ''}
      </table>
    </div>
    <p style="margin:26px 0"><a href="${escapeHtml(reportUrl)}" style="display:inline-block;background:#2563eb;color:white;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Download inspection report</a></p>
    <p style="color:#6b7280;font-size:13px">This private download link expires in 72 hours. Do not forward it.</p>
  </div>
  <div style="padding:16px 32px;background:#f1f5f9;text-align:center">
    <p style="color:#94a3b8;font-size:12px;margin:0">${escapeHtml(companyName)}${companyPhone ? ` · ${escapeHtml(companyPhone)}` : ''}${companyEmail ? ` · ${escapeHtml(companyEmail)}` : ''}</p>
  </div>
</div>`;
}

async function sendInspectionReportEmails({ params = {}, req, pool, caller, sendEmail, origin: trustedOrigin }) {
  if (typeof sendEmail !== 'function') throw new Error('Inspection report email transport is unavailable.');
  const { inspectionJobId, reportId } = params;
  if (!inspectionJobId || !reportId) throw httpError(400, 'Inspection job and uploaded report are required.');
  const job = await authorizeInspectionJob(pool, caller, inspectionJobId);
  const report = await getOwnedReport(pool, reportId, job);

  const companyRes = await pool.query(
    `SELECT name, phone, email, created_by FROM companies WHERE id = $1 LIMIT 1`,
    [job.companyId],
  );
  const company = companyRes.rows[0] || {};
  const companyName = company.name || 'Your Company';
  const companyPhone = company.phone || '';
  const companyEmail = company.email || '';
  let productionManagerEmail = params.productionManagerEmail || null;
  if (!productionManagerEmail) {
    const pmRes = await pool.query(
      `SELECT user_email FROM staff_profiles
       WHERE company_id = $1 AND (role = 'production_manager' OR role = 'Production Manager')
       LIMIT 1`,
      [job.companyId],
    );
    if (pmRes.rows[0]) productionManagerEmail = pmRes.rows[0].user_email;
    else {
      const adminRes = await pool.query(
        `SELECT user_email FROM staff_profiles
         WHERE company_id = $1 AND (is_administrator = true OR role = 'admin' OR role = 'owner')
         LIMIT 1`,
        [job.companyId],
      );
      productionManagerEmail = adminRes.rows[0]?.user_email || company.created_by || companyEmail || null;
    }
  }

  const clientName = job.data.client_name || 'Client';
  const address = job.data.property_address || 'Property';
  const claimNumber = job.data.insurance_claim_number || '';
  const recipients = [];
  const addRecipient = (key, enabled, email, label) => {
    if (!enabled || !String(email || '').trim()) return;
    recipients.push({ key, email: String(email).trim(), label });
  };
  addRecipient('client', params.sendToClient, params.clientEmail || job.data.client_email, clientName);
  addRecipient('adjuster', params.sendToAdjuster, params.adjusterEmail, 'Insurance Adjuster');
  addRecipient('production_manager', params.sendToProductionManager, productionManagerEmail, 'Production Manager');
  addRecipient('sales_rep', params.sendToSalesRep, params.salesRepEmail || job.data.sales_rep_email, 'Sales Rep');
  if (params.sendToCustomEmails) {
    const customEmails = typeof params.customEmails === 'string'
      ? params.customEmails.split(',')
      : Array.isArray(params.customEmails) ? params.customEmails : [];
    for (const email of customEmails) addRecipient('custom', true, email, 'Team Member');
  }
  const uniqueRecipients = [];
  const seenRecipients = new Set();
  for (const recipient of recipients) {
    const key = recipient.email.toLowerCase();
    if (seenRecipients.has(key)) continue;
    seenRecipients.add(key);
    uniqueRecipients.push(recipient);
  }
  if (!uniqueRecipients.length) {
    return { success: false, status: 'failed', error: 'Select at least one valid report recipient.' };
  }

  let origin;
  try {
    const parsedOrigin = new URL(trustedOrigin || getRequestOrigin(req));
    if (!['http:', 'https:'].includes(parsedOrigin.protocol) ||
        parsedOrigin.username || parsedOrigin.password) {
      throw new Error('invalid origin');
    }
    origin = parsedOrigin.origin;
  } catch {
    throw new Error('Cannot create an inspection report link without a trusted application URL.');
  }
  const from = process.env.EMAIL_FROM || `${companyName} <noreply@companysync.io>`;
  const results = [];
  for (const recipient of uniqueRecipients) {
    const sendState = await claimRecipientSend(pool, {
      report,
      job,
      recipientEmail: recipient.email,
    });
    if (!sendState.claimToken) {
      if (sendState.data.status === 'submitted' && sendState.data.result) {
        results.push({ ...sendState.data.result, reused: true });
      } else {
        results.push({
          type: recipient.key,
          status: 'failed',
          error: 'This report email is in progress or its outcome is uncertain. Check email activity before resending; it will not automatically send a duplicate.',
        });
      }
      continue;
    }
    let link;
    let providerAccepted = false;
    let providerAttempted = false;
    let definitiveRejection = false;
    try {
      link = await createRecipientReportLink({
        pool,
        report,
        job,
        recipientEmail: recipient.email,
        origin,
      });
      providerAttempted = true;
      const result = await sendEmail({
        from,
        to: [recipient.email],
        subject: `Inspection Report — ${clientName} | ${address}`,
        html: inspectionReportEmailHtml({
          recipientLabel: recipient.label,
          companyName,
          companyPhone,
          companyEmail,
          clientName,
          address,
          claimNumber,
          reportUrl: link.url,
        }),
         context: {
           companyId: job.companyId,
           actorEmail: caller.email,
           source: 'inspection_report',
          idempotencyKey: sendState.id,
         },
        correlationId: sendState.id,
      });
      if (result?.success !== true) {
        definitiveRejection = true;
        throw new Error('The email provider did not accept this report email.');
      }
      providerAccepted = true;
      const recipientResult = {
        type: recipient.key,
        status: 'submitted',
        provider: result.provider || null,
        messageId: result.id || null,
        accessId: link.accessId,
      };
      await finishRecipientSend(pool, {
        id: sendState.id,
        job,
        claimToken: sendState.claimToken,
        status: 'submitted',
        result: recipientResult,
      });
      results.push(recipientResult);
    } catch (error) {
      // Once the provider accepts an email, never revoke its download link or
      // release the send claim just because recording the receipt failed.
      // Keeping it claimed prevents an uncertain retry from sending twice.
      if (providerAccepted || (providerAttempted && !definitiveRejection)) {
        results.push({
          type: recipient.key,
          status: 'failed',
          error: 'Email submission may have been accepted, but its status is uncertain. Check email activity before resending; this report will not automatically send a duplicate.',
        });
        continue;
      }
      if (link?.accessId) {
        try { await revokeRecipientReportLink(pool, link.accessId, job.companyId); } catch {}
      }
      const errorMessage = error.message || 'Email submission failed.';
      await finishRecipientSend(pool, {
        id: sendState.id,
        job,
        claimToken: sendState.claimToken,
        status: 'failed',
        error: errorMessage,
      }).catch(() => {});
      results.push({ type: recipient.key, status: 'failed', error: errorMessage });
    }
  }

  const submitted = results.filter((result) => result.status === 'submitted');
  const failed = results.filter((result) => result.status === 'failed');
  const counts = {
    client_submitted: results.some((result) => result.type === 'client' && result.status === 'submitted'),
    adjuster_submitted: results.some((result) => result.type === 'adjuster' && result.status === 'submitted'),
    production_manager_submitted: results.some((result) => result.type === 'production_manager' && result.status === 'submitted'),
    sales_rep_submitted: results.some((result) => result.type === 'sales_rep' && result.status === 'submitted'),
    custom_submitted_count: results.filter((result) => result.type === 'custom' && result.status === 'submitted').length,
  };
  return {
    success: submitted.length > 0,
    status: submitted.length > 0 ? 'submitted' : 'failed',
    submitted_count: submitted.length,
    failed_count: failed.length,
    recipient_results: results,
    ...counts,
    // Kept for older consumers; true means provider accepted, never inbox delivery.
    client_sent: counts.client_submitted,
    adjuster_sent: counts.adjuster_submitted,
    production_manager_sent: counts.production_manager_submitted,
    sales_rep_sent: counts.sales_rep_submitted,
    custom_sent: counts.custom_submitted_count > 0,
    custom_count: counts.custom_submitted_count,
    ...(failed.length ? { error: `${failed.length} report email(s) could not be confirmed. ${failed[0].error}` } : {}),
  };
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

async function handleUploadRoute(req, res, { pool, caller, jobId, storage = objectStorage }) {
  try {
    const result = await uploadInspectionReport({ req, pool, caller, jobId, storage });
    sendJson(res, { success: true, ...result }, 201);
  } catch (error) {
    sendJson(res, { error: error.statusCode ? error.message : 'The report could not be stored securely.' }, error.statusCode || 500);
  }
}

async function handlePhotoRoute(req, res, { pool, caller, jobId, mediaId, photoCount, storage = objectStorage }) {
  try {
    const jpeg = await getInspectionJobPhoto({ pool, caller, jobId, mediaId, photoCount, storage });
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': jpeg.length,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(jpeg);
  } catch (error) {
    sendJson(res, { error: error.statusCode ? error.message : 'The inspection photo could not be loaded.' }, error.statusCode || 500);
  }
}

async function handleDownloadRoute(req, res, { pool, token, storage = objectStorage }) {
  try {
    const authorized = await loadAccessForDownload(pool, token);
    const pdf = await storage.downloadPrivateObject(authorized.accessData.storage_key, {
      maxBytes: MAX_PDF_BYTES,
      timeoutMs: 20000,
    });
    if (!pdf) throw httpError(404, 'This report link is invalid or expired.');
    validatePdfBuffer(pdf);
    const safeFilename = `InspectionReport_${authorized.accessData.jobId.replace(/[^a-z0-9_-]/gi, '_')}.pdf`;
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': pdf.length,
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    });
    res.end(pdf);
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, { error: status === 404 ? 'This report link is invalid or expired.' : (error.statusCode ? error.message : 'The report could not be downloaded.') }, status);
  }
}

module.exports = {
  MAX_PDF_BYTES,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_JPEG_BYTES,
  LINK_TTL_MS,
  validatePdfBuffer,
  readPdfBody,
  getInspectionJob,
  authorizeInspectionJob,
  uploadInspectionReport,
  getOwnedReport,
  resolveUploadFilename,
  readSafeImageDimensions,
  getInspectionJobPhoto,
  makeSignedAccessToken,
  parseSignedAccessToken,
  createRecipientReportLink,
  revokeRecipientReportLink,
  revokeInspectionReportLinks,
  getRequestOrigin,
  loadAccessForDownload,
  escapeHtml,
  inspectionReportEmailHtml,
  sendInspectionReportEmails,
  handleUploadRoute,
  handlePhotoRoute,
  handleDownloadRoute,
};