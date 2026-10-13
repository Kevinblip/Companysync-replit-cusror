'use strict';

const { randomUUID } = require('crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_PHOTOS_PER_BATCH = 50;
const MAX_CAPTION_LENGTH = 500;
const MAX_MILESTONE_LENGTH = 100;
const MAX_STORED_IMAGE_BYTES = 25 * 1024 * 1024;
const CANONICAL_PROJECT_CUSTOMER_ID_SQL =
  `COALESCE(NULLIF(related_customer_id, ''), NULLIF(data->>'related_customer_id', ''), ` +
  `NULLIF(customer_id, ''), NULLIF(data->>'customer_id', ''))`;
const BOUND_CREW_SHARE_CUSTOMER_FILTER_SQL = `(
  pp.source_customer_id = $3 OR (
    pp.source_customer_id IS NULL AND EXISTS (
      SELECT 1 FROM generic_entities legacy_media
      WHERE legacy_media.id = pp.source_media_id
        AND legacy_media.entity_type = 'JobMedia'
        AND legacy_media.company_id = $1
        AND legacy_media.data->>'related_entity_type' = 'Customer'
        AND legacy_media.data->>'related_entity_id' = $3
        AND legacy_media.data->>'source' IN ('crew_upload', 'whatsapp_upload')
    )
  )
)`;

function storedImageFileName(value, env = process.env) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) return null;
  if (value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return null;
  if (!value.startsWith('/') || value.includes('?') || value.includes('#')) return null;
  let decoded;
  try { decoded = decodeURIComponent(value); } catch (_) { return null; }
  if (decoded.includes('\\') || /[\u0000-\u001f?#]/.test(decoded)
    || decoded.split('/').some(part => part === '.' || part === '..')) return null;
  if (!/\.(?:jpe?g|png|webp|gif|heic|heif)$/i.test(decoded)) return null;

  let filename = null;
  if (decoded.startsWith('/uploads/')) {
    filename = decoded.slice('/uploads/'.length);
  } else {
    // serveUploadedFile maps legacy object paths to the first configured
    // object-storage search path, so accepting another prefix would validate
    // different bytes from the ones the homeowner actually receives.
    const firstPrefix = String(env.PUBLIC_OBJECT_SEARCH_PATHS || '').split(',')[0]
      .trim().replace(/\/+$/, '');
    if (firstPrefix?.startsWith('/') && !firstPrefix.startsWith('//')
      && !firstPrefix.includes('..') && decoded.startsWith(`${firstPrefix}/`)) {
      filename = decoded.slice(firstPrefix.length + 1);
    }
  }
  if (!filename || filename.includes('/') || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(filename)) return null;
  return filename;
}

function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseData(data) {
  if (!data) return {};
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch (_) { return {}; }
  }
  return data;
}

/**
 * Project galleries only persist local app upload paths or paths under an
 * explicitly configured public object-storage prefix. URL-like external paths
 * are never accepted or fetched.
 */
function isSafeStoredImageUrl(value, env = process.env) {
  return storedImageFileName(value, env) !== null;
}

function isImageBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return true;
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return true;
  return buffer.subarray(4, 8).toString('ascii') === 'ftyp'
    && /^(?:heic|heix|hevc|hevx|mif1|msf1|avif|avis)$/.test(buffer.subarray(8, 12).toString('ascii'));
}

async function readLocalImageHeader(filename, uploadsDir) {
  const appRoot = path.resolve(__dirname, '..');
  const candidateDirs = [
    uploadsDir,
    path.join(appRoot, 'uploads'),
    path.join(process.cwd(), 'public', 'uploads'),
    path.join(process.cwd(), 'public'),
    path.join(process.cwd(), 'dist'),
    process.cwd(),
  ].filter(Boolean);
  for (const directory of [...new Set(candidateDirs)]) {
    const root = path.resolve(directory);
    const filePath = path.resolve(root, filename);
    if (path.dirname(filePath) !== root) return { found: true, isImage: false };
    try {
      const info = await fs.lstat(filePath);
      if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_STORED_IMAGE_BYTES) {
        return { found: true, isImage: false };
      }
      const handle = await fs.open(filePath, 'r');
      try {
        const header = Buffer.alloc(32);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        return { found: true, isImage: isImageBytes(header.subarray(0, bytesRead)) };
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error.code !== 'ENOENT') return { found: true, isImage: false };
    }
  }
  return { found: false, isImage: false };
}

async function validateStoredImageUrl(value, options = {}) {
  const env = options.env || process.env;
  const filename = storedImageFileName(value, env);
  if (!filename) return false;

  // Match serveUploadedFile's authoritative order: object storage, the
  // legacy database store, then disk/cache. Only the validated basename is
  // passed to the configured storage helper; caller URLs are never fetched.
  try {
    const loadStoredObject = options.downloadObject
      || require('../db/object-storage.cjs').downloadFromObjectStorageBounded;
    const bytes = await loadStoredObject(filename, {
      maxBytes: MAX_STORED_IMAGE_BYTES,
      timeoutMs: options.timeoutMs || 5000,
    });
    if (bytes) return bytes.length <= MAX_STORED_IMAGE_BYTES && isImageBytes(bytes);
  } catch (error) {
    if (error?.statusCode === 413) return false;
    // serveUploadedFile also falls through to the database if object storage
    // is unavailable.
  }
  if (options.pool) {
    try {
      const stored = await options.pool.query(
        `SELECT CASE WHEN octet_length(file_data) <= $2 THEN file_data ELSE NULL END AS file_data,
                octet_length(file_data) AS file_size
         FROM file_uploads
         WHERE id = $1 AND file_data IS NOT NULL
         LIMIT 1`,
        [filename, MAX_STORED_IMAGE_BYTES]
      );
      const bytes = stored.rows[0]?.file_data;
      if (stored.rows[0]?.file_size > MAX_STORED_IMAGE_BYTES) return false;
      if (bytes) return Buffer.isBuffer(bytes)
        && bytes.length <= MAX_STORED_IMAGE_BYTES && isImageBytes(bytes);
    } catch (_) {
      // Match serveUploadedFile: a database lookup error still falls through
      // to the configured disk candidates.
    }
  }
  const local = await readLocalImageHeader(filename, options.uploadsDir);
  return local.found && local.isImage;
}

function normalizeCaption(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw httpError('Photo caption must be text');
  const caption = value.trim();
  if (caption.length > MAX_CAPTION_LENGTH) throw httpError(`Photo caption must be ${MAX_CAPTION_LENGTH} characters or fewer`);
  return caption || null;
}

function normalizeMilestone(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw httpError('Photo milestone must be text');
  const milestone = value.trim();
  if (milestone.length > MAX_MILESTONE_LENGTH) throw httpError(`Photo milestone must be ${MAX_MILESTONE_LENGTH} characters or fewer`);
  return milestone || null;
}

async function hasActiveCompanyAccess(pool, user, companyId) {
  if (!user?.email) return false;
  if (user.platform_role === 'super_admin' || user.is_super_admin) return true;
  const staff = await pool.query(
    `SELECT id, is_active FROM staff_profiles
     WHERE company_id = $1
       AND (LOWER(user_email) = LOWER($2) OR LOWER(email) = LOWER($2))
     LIMIT 10 FOR SHARE`,
    [companyId, user.email]
  );
  // An inactive matching profile is not rescued by the company-owner fallback.
  if (staff.rows.length) return staff.rows.some(row => row.is_active === true);

  // Company creators can be authenticated owners without a StaffProfile.
  const owner = await pool.query(
    `SELECT id FROM generic_entities
     WHERE entity_type = 'Company' AND id = $1
       AND LOWER(data->>'created_by') = LOWER($2)
     LIMIT 1 FOR SHARE`,
    [companyId, user.email]
  );
  return owner.rows.length > 0;
}

async function listCustomerCrewPhotos(pool, customerId, authorizedCompanyId, actor) {
  if (typeof customerId !== 'string' || !customerId.trim()) {
    throw httpError('customer_id is required');
  }
  if (!authorizedCompanyId) throw httpError('Authorized company context is required', 403);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const customerResult = await client.query(
      `SELECT id, company_id FROM customers WHERE id = $1 FOR SHARE`,
      [customerId]
    );
    const customer = customerResult.rows[0];
    if (!customer) throw httpError('Customer not found', 404);
    if (customer.company_id !== authorizedCompanyId) throw httpError('Customer company context changed', 403);
    if (!(await hasActiveCompanyAccess(client, actor, authorizedCompanyId))) throw httpError('Forbidden', 403);

    const projectResult = await client.query(
      `SELECT id, title, address, project_type, data
       FROM projects
       WHERE company_id = $1
         AND ${CANONICAL_PROJECT_CUSTOMER_ID_SQL} = $2
         AND status != 'cancelled'
       ORDER BY created_at DESC, id
       FOR SHARE`,
      [authorizedCompanyId, customerId]
    );
    const projects = projectResult.rows.map(row => {
      const data = parseData(row.data);
      return {
        id: row.id,
        name: data.name || row.title || '',
        title: row.title || data.title || '',
        address: row.address || data.address || '',
        project_type: row.project_type || data.project_type || null,
      };
    });
    let shares = [];
    if (projects.length) {
      const photoResult = await client.query(
        `SELECT pp.id, pp.project_id, pp.source_media_id, pp.is_public, pp.caption, pp.milestone
         FROM project_photos pp
         WHERE pp.company_id = $1 AND pp.project_id = ANY($2::text[])
           AND pp.source_media_id IS NOT NULL
           AND ${BOUND_CREW_SHARE_CUSTOMER_FILTER_SQL}
         ORDER BY pp.created_at DESC, pp.id`,
        [authorizedCompanyId, projects.map(project => project.id), customerId]
      );
      shares = photoResult.rows.map(row => ({
        id: row.id,
        project_id: row.project_id,
        source_media_id: row.source_media_id,
        is_public: row.is_public === true,
        caption: row.caption || null,
        milestone: row.milestone || null,
      }));
    }
    await client.query('COMMIT');
    return { success: true, projects, shares };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function publishCrewPhotos(pool, {
  projectId,
  customerId,
  authorizedCompanyId,
  actor,
  photos,
}, options = {}) {
  if (typeof customerId !== 'string' || !customerId.trim()) throw httpError('customer_id is required');
  if (!authorizedCompanyId) throw httpError('Authorized company context is required', 403);
  if (!Array.isArray(photos) || photos.length === 0) throw httpError('photos must be a non-empty array');
  if (photos.length > MAX_PHOTOS_PER_BATCH) throw httpError(`A maximum of ${MAX_PHOTOS_PER_BATCH} photos may be shared at once`);

  const normalized = photos.map((photo, index) => {
    if (!photo || typeof photo !== 'object' || Array.isArray(photo)) {
      throw httpError(`photos[${index}] must be an object`);
    }
    if (typeof photo.media_id !== 'string' || !photo.media_id.trim()) {
      throw httpError(`photos[${index}].media_id is required`);
    }
    const hasCaption = Object.prototype.hasOwnProperty.call(photo, 'caption');
    const hasMilestone = Object.prototype.hasOwnProperty.call(photo, 'milestone');
    return {
      mediaId: photo.media_id.trim(),
      caption: normalizeCaption(photo.caption),
      milestone: normalizeMilestone(photo.milestone),
      hasCaption,
      hasMilestone,
    };
  });
  // A single source ID can only map to one gallery photo in a project.
  const uniqueByMedia = new Map();
  for (const photo of normalized) {
    if (!uniqueByMedia.has(photo.mediaId)) uniqueByMedia.set(photo.mediaId, photo);
  }
  const selected = [...uniqueByMedia.values()];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const customerResult = await client.query(
      `SELECT id, company_id FROM customers WHERE id = $1 FOR SHARE`,
      [customerId]
    );
    const customer = customerResult.rows[0];
    if (!customer) throw httpError('Customer not found', 404);
    if (customer.company_id !== authorizedCompanyId) throw httpError('Customer company context changed', 403);
    if (!(await hasActiveCompanyAccess(client, actor, authorizedCompanyId))) throw httpError('Forbidden', 403);

    const projectResult = await client.query(
      `SELECT id, company_id FROM projects
       WHERE id = $1 AND company_id = $2 AND status != 'cancelled'
         AND ${CANONICAL_PROJECT_CUSTOMER_ID_SQL} = $3
       FOR UPDATE`,
      [projectId, authorizedCompanyId, customerId]
    );
    if (!projectResult.rows.length) throw httpError('Project is not an active project linked to this customer', 404);

    const mediaResult = await client.query(
      `SELECT id, company_id, data FROM generic_entities
       WHERE entity_type = 'JobMedia' AND company_id = $1
         AND id = ANY($2::text[])
       FOR SHARE`,
      [customer.company_id, selected.map(photo => photo.mediaId)]
    );
    const mediaById = new Map(mediaResult.rows.map(row => [row.id, row]));
    for (const photo of selected) {
      const media = mediaById.get(photo.mediaId);
      if (!media) throw httpError(`Crew photo ${photo.mediaId} was not found in this company`, 404);
      const data = parseData(media.data);
      const source = String(data.source || '').toLowerCase();
      const isCrewPhoto = source === 'crew_upload' || source === 'whatsapp_upload';
      if (!isCrewPhoto || data.file_type !== 'photo'
        || data.related_entity_type !== 'Customer' || data.related_entity_id !== customerId) {
        throw httpError(`Media ${photo.mediaId} is not a crew photo for this customer`, 400);
      }
      const validateImage = options.validateImage || validateStoredImageUrl;
      const imageValidationOptions = {
        ...(options.imageValidationOptions || {}),
        pool: options.imageValidationOptions?.pool || client,
      };
      if (!(await validateImage(data.file_url, imageValidationOptions))) {
        throw httpError(`Crew photo ${photo.mediaId} has a missing or unsafe stored image URL`, 400);
      }
      photo.fileUrl = data.file_url;
      if (!photo.hasCaption) photo.caption = normalizeCaption(data.caption);
    }

    for (const photo of selected) {
      await client.query(
        `INSERT INTO project_photos
           (id, project_id, company_id, photo_url, caption, milestone, is_public,
            uploaded_by, source_media_id, source_customer_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,NOW())
         ON CONFLICT (project_id, source_media_id)
           WHERE source_media_id IS NOT NULL
         DO UPDATE SET
           photo_url = EXCLUDED.photo_url,
            caption = CASE WHEN $10 THEN EXCLUDED.caption ELSE project_photos.caption END,
            milestone = CASE WHEN $11 THEN EXCLUDED.milestone ELSE project_photos.milestone END,
            source_customer_id = EXCLUDED.source_customer_id,
           is_public = true
         WHERE project_photos.company_id = EXCLUDED.company_id
           AND (project_photos.source_customer_id IS NULL
             OR project_photos.source_customer_id = EXCLUDED.source_customer_id)`,
        [
          `pphoto_${randomUUID()}`,
          projectId,
          customer.company_id,
          photo.fileUrl,
          photo.caption,
          photo.milestone,
          actor.email,
          photo.mediaId,
          customerId,
          photo.hasCaption,
          photo.hasMilestone,
        ]
      );
    }

    const sharesResult = await client.query(
      `SELECT id, project_id, source_media_id, source_customer_id, is_public, caption, milestone
       FROM project_photos
        WHERE project_id = $1 AND source_media_id = ANY($2::text[])
          AND company_id = $3 AND source_customer_id = $4
       ORDER BY created_at`,
      [projectId, selected.map(photo => photo.mediaId), customer.company_id, customerId]
    );
    if (sharesResult.rows.length !== selected.length) {
      throw httpError('An existing project share belongs to a different company or customer', 409);
    }
    await client.query('COMMIT');
    return {
      success: true,
      shares: sharesResult.rows.map(row => ({
        id: row.id,
        project_id: row.project_id,
        source_media_id: row.source_media_id,
        is_public: row.is_public === true,
        caption: row.caption || null,
        milestone: row.milestone || null,
      })),
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function setCrewSharePublic(pool, { projectId, photoId, authorizedCompanyId, actor, isPublic }) {
  if (!authorizedCompanyId) throw httpError('Authorized company context is required', 403);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const project = await client.query(
      `SELECT id, company_id FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId]
    );
    if (!project.rows.length || project.rows[0].company_id !== authorizedCompanyId) {
      throw httpError('Project not found', 404);
    }
    if (!(await hasActiveCompanyAccess(client, actor, authorizedCompanyId))) throw httpError('Forbidden', 403);
    const share = await client.query(
      `SELECT id FROM project_photos
       WHERE id = $1 AND project_id = $2 AND company_id = $3
         AND source_media_id IS NOT NULL
       FOR UPDATE`,
      [photoId, projectId, authorizedCompanyId]
    );
    if (!share.rows.length) throw httpError('Project photo not found', 404);
    const updated = await client.query(
      `UPDATE project_photos
       SET is_public = $4
       WHERE id = $1 AND project_id = $2 AND company_id = $3
         AND source_media_id IS NOT NULL
       RETURNING id`,
      [photoId, projectId, authorizedCompanyId, isPublic === true]
    );
    if (!updated.rows.length) throw httpError('Project photo not found', 404);
    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  MAX_PHOTOS_PER_BATCH,
  hasActiveCompanyAccess,
  isSafeStoredImageUrl,
  validateStoredImageUrl,
  listCustomerCrewPhotos,
  publishCrewPhotos,
  setCrewSharePublic,
};