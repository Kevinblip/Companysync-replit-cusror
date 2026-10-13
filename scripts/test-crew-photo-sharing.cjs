'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  hasActiveCompanyAccess,
  isSafeStoredImageUrl,
  listCustomerCrewPhotos: listCustomerCrewPhotosRaw,
  publishCrewPhotos: publishCrewPhotosRaw,
  setCrewSharePublic,
  validateStoredImageUrl,
} = require('../lib/crewPhotoSharing.cjs');

function canonicalProjectCustomer(project) {
  const data = typeof project.data === 'string' ? JSON.parse(project.data) : (project.data || {});
  return project.related_customer_id || data.related_customer_id || project.customer_id || data.customer_id || null;
}

class MemoryPool {
  constructor() {
    this.customers = [
      { id: 'cust-a', company_id: 'co-a' },
      { id: 'cust-b', company_id: 'co-a' },
      { id: 'cust-other-company', company_id: 'co-b' },
    ];
    this.projects = [
      { id: 'project-customer-id', company_id: 'co-a', customer_id: 'cust-a', related_customer_id: null, status: 'active', title: 'Main roof', address: '1 Main St', project_type: 'standard', data: {} },
      { id: 'project-related-id', company_id: 'co-a', customer_id: null, related_customer_id: 'cust-a', status: 'active', title: 'Garage', address: '2 Main St', project_type: 'standard', data: {} },
      { id: 'project-jsonb-related-id', company_id: 'co-a', customer_id: null, related_customer_id: null, status: 'active', title: 'Legacy JSONB link', address: '5 Main St', project_type: 'standard', data: { related_customer_id: 'cust-a' } },
      { id: 'project-conflicting-columns', company_id: 'co-a', customer_id: 'cust-a', related_customer_id: 'cust-b', status: 'active', title: 'Conflicting columns', address: '6 Main St', project_type: 'standard', data: {} },
      { id: 'project-conflicting-jsonb', company_id: 'co-a', customer_id: 'cust-a', related_customer_id: null, status: 'active', title: 'Conflicting JSONB', address: '7 Main St', project_type: 'standard', data: { related_customer_id: 'cust-b' } },
      { id: 'project-same-name-only', company_id: 'co-a', customer_id: 'cust-b', related_customer_id: null, status: 'active', title: 'Same customer name', address: '3 Main St', project_type: 'standard', data: {} },
      { id: 'project-other-company', company_id: 'co-b', customer_id: 'cust-a', related_customer_id: null, status: 'active', title: 'Wrong tenant', address: '4 Main St', project_type: 'standard', data: {} },
      { id: 'project-cancelled', company_id: 'co-a', customer_id: 'cust-a', related_customer_id: null, status: 'cancelled', title: 'Cancelled', address: '8 Main St', project_type: 'standard', data: {} },
    ];
    this.media = [
      { id: 'media-a', company_id: 'co-a', data: { related_entity_type: 'Customer', related_entity_id: 'cust-a', source: 'crew_upload', file_type: 'photo', file_url: '/uploads/crew-a.jpg', caption: 'Original caption' } },
      { id: 'media-wa', company_id: 'co-a', data: { related_entity_type: 'Customer', related_entity_id: 'cust-a', source: 'whatsapp_upload', section: 'crew_upload', file_type: 'photo', file_url: '/uploads/wa-a.png' } },
      { id: 'media-wrong-customer', company_id: 'co-a', data: { related_entity_type: 'Customer', related_entity_id: 'cust-b', source: 'crew_upload', file_url: '/uploads/other.jpg' } },
      { id: 'media-wrong-company', company_id: 'co-b', data: { related_entity_type: 'Customer', related_entity_id: 'cust-a', source: 'crew_upload', file_url: '/uploads/wrong.jpg' } },
      { id: 'media-unsafe', company_id: 'co-a', data: { related_entity_type: 'Customer', related_entity_id: 'cust-a', source: 'crew_upload', file_type: 'photo', file_url: 'http://169.254.169.254/latest/meta-data' } },
      { id: 'media-missing', company_id: 'co-a', data: { related_entity_type: 'Customer', related_entity_id: 'cust-a', source: 'crew_upload', file_type: 'photo', file_url: '/uploads/missing.jpg' } },
    ];
    this.photos = [];
    this.zeroPhotoUpdates = false;
    this.staffProfiles = [
      { email: 'staff@co-a', company_id: 'co-a', is_active: true },
      { email: 'disabled@co-a', company_id: 'co-a', is_active: false },
    ];
  }

  async connect() { return this; }
  release() {}

  async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (text.includes('FROM customers WHERE id = $1')) {
      return { rows: this.customers.filter(row => row.id === params[0]) };
    }
    if (text.includes('FROM staff_profiles')) {
      return {
        rows: this.staffProfiles
          .filter(row => row.company_id === params[0] && row.email.toLowerCase() === params[1].toLowerCase())
          .map((row, index) => ({ id: `staff-${index}`, is_active: row.is_active })),
      };
    }
    if (text.includes("FROM generic_entities") && text.includes("entity_type = 'Company'")) return { rows: [] };
    if (text.includes('FROM projects') && text.includes('WHERE company_id = $1')) {
      return {
        rows: this.projects.filter(row => row.company_id === params[0]
          && canonicalProjectCustomer(row) === params[1] && row.status !== 'cancelled'),
      };
    }
    if (text.includes('FROM projects') && text.includes('WHERE id = $1')) {
      let row = this.projects.find(project => project.id === params[0]);
      if (row && text.includes('company_id = $2')) {
        row = row.company_id === params[1] && canonicalProjectCustomer(row) === params[2]
          && row.status !== 'cancelled' ? row : null;
      }
      return { rows: row ? [{ id: row.id, company_id: row.company_id }] : [] };
    }
    if (text.includes('FROM generic_entities') && !text.includes('FROM generic_entities legacy_media')
      && text.includes("entity_type = 'JobMedia'")) {
      const ids = params[1];
      return { rows: this.media.filter(row => row.company_id === params[0] && ids.includes(row.id)) };
    }
    if (text.startsWith('INSERT INTO project_photos')) {
      const [id, project_id, company_id, photo_url, caption, milestone, uploaded_by, source_media_id, source_customer_id] = params;
      const hasCaption = params[9];
      const hasMilestone = params[10];
      const existing = this.photos.find(row => row.project_id === project_id && row.source_media_id === source_media_id);
      if (existing) {
        if (existing.company_id === company_id
          && (!existing.source_customer_id || existing.source_customer_id === source_customer_id)) {
          existing.photo_url = photo_url;
          existing.source_customer_id = source_customer_id;
          if (hasCaption) existing.caption = caption;
          if (hasMilestone) existing.milestone = milestone;
          existing.is_public = true;
        }
      } else {
        this.photos.push({ id, project_id, company_id, photo_url, caption, milestone, is_public: true, uploaded_by, source_media_id, source_customer_id });
      }
      return { rows: [] };
    }
    if (text.includes('FROM project_photos') && text.includes('source_media_id IS NOT NULL') && text.includes('WHERE id = $1')) {
      const [photoId, projectId, companyId] = params;
      return { rows: this.photos.filter(row => row.id === photoId
        && row.project_id === projectId && row.company_id === companyId && row.source_media_id !== null) };
    }
    if (text.includes('FROM project_photos') && text.includes('source_media_id IS NOT NULL')) {
      const [companyId, projectIds, customerId] = params;
      return { rows: this.photos.filter(row => row.company_id === companyId
        && projectIds.includes(row.project_id) && row.source_media_id !== null
        && (row.source_customer_id === customerId || (!row.source_customer_id
          && this.media.some(media => media.id === row.source_media_id
            && media.company_id === companyId && media.data.related_entity_id === customerId
            && ['crew_upload', 'whatsapp_upload'].includes(media.data.source))))) };
    }
    if (text.includes('FROM project_photos') && text.includes('source_media_id = ANY')) {
      const [projectId, mediaIds, companyId, customerId] = params;
      return { rows: this.photos.filter(row => row.project_id === projectId
        && row.company_id === companyId && mediaIds.includes(row.source_media_id)
        && row.source_customer_id === customerId) };
    }
    if (text.startsWith('UPDATE project_photos')) {
      if (this.zeroPhotoUpdates) return { rows: [] };
      const [photoId, projectId, companyId, isPublic] = params;
      const row = this.photos.find(photo => photo.id === photoId
        && photo.project_id === projectId && photo.company_id === companyId
        && photo.source_media_id !== null);
      if (!row) return { rows: [] };
      row.is_public = isPublic;
      return { rows: [{ id: row.id }] };
    }
    throw new Error(`Unexpected SQL in crew-photo test fake: ${text}`);
  }
}

const TEST_ACTOR = { email: 'staff@co-a' };

function listCustomerCrewPhotos(pool, customerId) {
  return listCustomerCrewPhotosRaw(pool, customerId, 'co-a', TEST_ACTOR);
}

function publishCrewPhotos(pool, payload, options) {
  return publishCrewPhotosRaw(pool, {
    ...payload,
    authorizedCompanyId: 'co-a',
    actor: TEST_ACTOR,
  }, options);
}

async function main() {
  const uploadsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'crew-sharing-'));
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  await fsp.writeFile(path.join(uploadsDir, 'crew-a.jpg'), jpegHeader);
  await fsp.writeFile(path.join(uploadsDir, 'wa-a.png'), pngHeader);
  const imageValidationOptions = { uploadsDir, downloadObject: async () => null };

  assert.equal(isSafeStoredImageUrl('/uploads/crew-a.jpg'), true);
  assert.equal(isSafeStoredImageUrl('/replit-objstore-bucket/public/photo.webp', {
    PUBLIC_OBJECT_SEARCH_PATHS: '/replit-objstore-bucket/public',
  }), true);
  assert.equal(isSafeStoredImageUrl('/replit-objstore-second/public/photo.webp', {
    PUBLIC_OBJECT_SEARCH_PATHS: '/replit-objstore-first/public,/replit-objstore-second/public',
  }), false, 'legacy paths outside serveUploadedFile’s first configured bucket are rejected');
  assert.equal(isSafeStoredImageUrl('https://example.com/photo.jpg'), false);
  assert.equal(isSafeStoredImageUrl('//example.com/photo.jpg'), false);
  assert.equal(isSafeStoredImageUrl('/uploads/../secrets.jpg'), false);
  assert.equal(isSafeStoredImageUrl('/uploads/not-an-image.txt'), false);
  assert.equal(await validateStoredImageUrl('/uploads/crew-a.jpg', imageValidationOptions), true);
  assert.equal(await validateStoredImageUrl('/uploads/missing.png', imageValidationOptions), false);
  await fsp.writeFile(path.join(uploadsDir, 'not-really.png'), Buffer.from('not an image'));
  assert.equal(await validateStoredImageUrl('/uploads/not-really.png', imageValidationOptions), false);
  const storageOrderFile = path.join(uploadsDir, 'storage-order.jpg');
  await fsp.writeFile(storageOrderFile, jpegHeader);
  let storageDbReads = 0;
  const storageDb = {
    async query() {
      storageDbReads += 1;
      return { rows: [{ file_data: pngHeader }] };
    },
  };
  assert.equal(await validateStoredImageUrl('/uploads/storage-order.jpg', {
    uploadsDir,
    pool: storageDb,
    downloadObject: async () => Buffer.from('cloud object is not an image'),
  }), false, 'invalid authoritative cloud bytes are not overridden by valid DB/disk cache copies');
  assert.equal(storageDbReads, 0, 'cloud storage is checked before DB and disk');
  const oversizedCloud = Object.assign(new Error('oversized object'), { statusCode: 413 });
  assert.equal(await validateStoredImageUrl('/uploads/storage-order.jpg', {
    uploadsDir,
    pool: storageDb,
    downloadObject: async () => { throw oversizedCloud; },
  }), false, 'oversized authoritative cloud objects are rejected without stale cache fallback');
  assert.equal(storageDbReads, 0);
  assert.equal(await validateStoredImageUrl('/uploads/storage-order.jpg', {
    uploadsDir,
    pool: { async query() { return { rows: [{ file_data: Buffer.from('DB authoritative invalid'), file_size: 25 }] }; } },
    downloadObject: async () => null,
  }), false, 'invalid DB bytes are not overridden by a valid disk cache');
  assert.equal(await validateStoredImageUrl('/uploads/storage-order.jpg', {
    uploadsDir,
    pool: { async query() { return { rows: [{ file_data: null, file_size: 25 * 1024 * 1024 + 1 }] }; } },
    downloadObject: async () => null,
  }), false, 'oversized authoritative DB objects are rejected without a disk cache fallback');
  assert.equal(await validateStoredImageUrl('/uploads/storage-order.jpg', {
    uploadsDir,
    pool: { async query() { return { rows: [{ file_data: pngHeader }] }; } },
    downloadObject: async () => null,
  }), true, 'DB fallback precedes disk when cloud storage misses');
  assert.equal(await validateStoredImageUrl('/uploads/storage-order.jpg', {
    uploadsDir,
    pool: { async query() { return { rows: [] }; } },
    downloadObject: async () => null,
  }), true, 'disk is consulted only after cloud and DB misses');
  let downloadedName = null;
  assert.equal(await validateStoredImageUrl('/replit-objstore-bucket/public/remote.png', {
    ...imageValidationOptions,
    env: { PUBLIC_OBJECT_SEARCH_PATHS: '/replit-objstore-bucket/public' },
    downloadObject: async (filename, opts) => {
      downloadedName = filename;
      assert.equal(opts.maxBytes, 25 * 1024 * 1024);
      return pngHeader;
    },
  }), true);
  assert.equal(downloadedName, 'remote.png', 'object storage check receives only the validated basename');
  assert.equal(await validateStoredImageUrl('http://169.254.169.254/latest/meta-data', {
    ...imageValidationOptions,
    downloadObject: async () => { throw new Error('must not be called'); },
  }), false);

  const pool = new MemoryPool();
  assert.equal(await hasActiveCompanyAccess(pool, { email: 'staff@co-a' }, 'co-a'), true);
  assert.equal(await hasActiveCompanyAccess(pool, { email: 'disabled@co-a' }, 'co-a'), false);
  await assert.rejects(
    publishCrewPhotosRaw(pool, {
      projectId: 'project-customer-id',
      customerId: 'cust-a',
      authorizedCompanyId: 'co-a',
      actor: { email: 'disabled@co-a' },
      photos: [{ media_id: 'media-a' }],
    }, { imageValidationOptions }),
    error => error.statusCode === 403
  );
  await assert.rejects(
    listCustomerCrewPhotosRaw(pool, 'cust-a', 'co-b', TEST_ACTOR),
    error => error.statusCode === 403
  );
  await assert.rejects(
    publishCrewPhotos(pool, {
      projectId: 'project-customer-id',
      customerId: 'cust-a',
      photos: Array.from({ length: 51 }, (_, index) => ({ media_id: `media-${index}` })),
    }, { imageValidationOptions }),
    /maximum of 50 photos/
  );
  await assert.rejects(
    publishCrewPhotos(pool, {
      projectId: 'project-customer-id',
      customerId: 'cust-a',
      photos: [{ media_id: 'media-a', caption: 'x'.repeat(501) }],
    }, { imageValidationOptions }),
    /500 characters or fewer/
  );

  const initial = await publishCrewPhotos(pool, {
    projectId: 'project-customer-id',
    customerId: 'cust-a',
    uploadedBy: 'staff@co-a',
    photos: [
      { media_id: 'media-a', caption: 'Homeowner caption', milestone: 'build_complete' },
      { media_id: 'media-wa' },
      { media_id: 'media-a' },
    ],
  }, { imageValidationOptions });
  assert.equal(initial.success, true);
  assert.equal(initial.shares.length, 2, 'duplicate media IDs in one batch create one share');
  assert.equal(initial.shares.every(share => share.is_public), true);
  assert.deepEqual(new Set(initial.shares.map(share => share.source_media_id)), new Set(['media-a', 'media-wa']));
  assert.ok(initial.shares.every(share => pool.photos.find(row => row.id === share.id).source_customer_id === 'cust-a'),
    'every new crew share is persisted with its publishing customer binding');
  assert.equal(pool.photos.find(row => row.source_media_id === 'media-a').caption, 'Homeowner caption');

  await publishCrewPhotos(pool, {
    projectId: 'project-customer-id',
    customerId: 'cust-a',
    photos: [{ media_id: 'media-a' }, { media_id: 'media-wa' }],
  }, { imageValidationOptions });
  assert.equal(pool.photos.length, 2, 'retry/concurrent-style duplicate publish is idempotent');

  const concurrentPool = new MemoryPool();
  const concurrentResults = await Promise.all([
    publishCrewPhotos(concurrentPool, {
      projectId: 'project-customer-id',
      customerId: 'cust-a',
      photos: [{ media_id: 'media-a' }],
    }, { imageValidationOptions }),
    publishCrewPhotos(concurrentPool, {
      projectId: 'project-customer-id',
      customerId: 'cust-a',
      photos: [{ media_id: 'media-a' }],
    }, { imageValidationOptions }),
  ]);
  assert.equal(concurrentPool.photos.length, 1, 'concurrent duplicate requests create one project share');
  assert.equal(concurrentResults.every(result => result.shares.length === 1), true);

  const beforeInvalidBatch = pool.photos.length;
  await assert.rejects(
    publishCrewPhotos(pool, {
      projectId: 'project-customer-id',
      customerId: 'cust-a',
      photos: [{ media_id: 'media-a' }, { media_id: 'media-unsafe' }],
    }, { imageValidationOptions }),
    /missing or unsafe stored image URL/
  );
  await assert.rejects(
    publishCrewPhotos(pool, {
      projectId: 'project-customer-id',
      customerId: 'cust-a',
      photos: [{ media_id: 'media-a' }, { media_id: 'media-missing' }],
    }, { imageValidationOptions }),
    /missing or unsafe stored image URL/
  );
  await assert.rejects(
    publishCrewPhotos(pool, {
      projectId: 'project-customer-id',
      customerId: 'cust-a',
      photos: [{ media_id: 'media-wrong-customer' }],
    }, { imageValidationOptions }),
    /not a crew photo for this customer/
  );
  await assert.rejects(
    publishCrewPhotos(pool, {
      projectId: 'project-other-company',
      customerId: 'cust-a',
      photos: [{ media_id: 'media-a' }],
    }, { imageValidationOptions }),
    /active project linked to this customer/
  );
  await assert.rejects(
    publishCrewPhotos(pool, {
      projectId: 'project-cancelled',
      customerId: 'cust-a',
      photos: [{ media_id: 'media-a' }],
    }, { imageValidationOptions }),
    /active project linked to this customer/
  );
  await assert.rejects(
    publishCrewPhotos(pool, {
      projectId: 'project-customer-id',
      customerId: 'cust-a',
      photos: [{ media_id: 'media-wrong-company' }],
    }, { imageValidationOptions }),
    /was not found in this company/
  );
  assert.equal(pool.photos.length, beforeInvalidBatch, 'invalid batches do not partially publish');

  const secondProject = await publishCrewPhotos(pool, {
    projectId: 'project-related-id',
    customerId: 'cust-a',
    photos: [{ media_id: 'media-a' }],
  }, { imageValidationOptions });
  assert.equal(secondProject.shares.length, 1, 'related_customer_id links are supported');
  const legacyProject = await publishCrewPhotos(pool, {
    projectId: 'project-jsonb-related-id',
    customerId: 'cust-a',
    photos: [{ media_id: 'media-a' }],
  }, { imageValidationOptions });
  assert.equal(legacyProject.shares.length, 1, 'legacy data.related_customer_id links are supported');
  await assert.rejects(
    publishCrewPhotos(pool, {
      projectId: 'project-conflicting-columns',
      customerId: 'cust-a',
      photos: [{ media_id: 'media-a' }],
    }, { imageValidationOptions }),
    /active project linked to this customer/
  );

  const customerGallery = await listCustomerCrewPhotos(pool, 'cust-a');
  assert.deepEqual(customerGallery.projects.map(project => project.id).sort(), [
    'project-customer-id',
    'project-jsonb-related-id',
    'project-related-id',
  ]);
  assert.equal(customerGallery.projects.some(project => project.id === 'project-cancelled'), false);
  assert.equal(customerGallery.shares.length, 4);
  assert.ok(customerGallery.shares.every(share => share.source_media_id));
  const customerBGallery = await listCustomerCrewPhotos(pool, 'cust-b');
  assert.deepEqual(customerBGallery.projects.map(project => project.id).sort(), [
    'project-conflicting-columns',
    'project-conflicting-jsonb',
    'project-same-name-only',
  ], 'canonical links prevent the conflicting project from leaking to customer A');

  // Crew-share hide is locked, company-bound, active-membership authorized,
  // and must not succeed if its conditional update affects no row.
  const existingPhotoId = pool.photos[0].id;
  await assert.rejects(
    setCrewSharePublic(pool, {
      projectId: 'project-customer-id',
      photoId: 'missing-photo',
      authorizedCompanyId: 'co-a',
      actor: TEST_ACTOR,
      isPublic: false,
    }),
    error => error.statusCode === 404
  );
  pool.zeroPhotoUpdates = true;
  await assert.rejects(
    setCrewSharePublic(pool, {
      projectId: 'project-customer-id',
      photoId: existingPhotoId,
      authorizedCompanyId: 'co-a',
      actor: TEST_ACTOR,
      isPublic: false,
    }),
    error => error.statusCode === 404
  );
  pool.zeroPhotoUpdates = false;
  await setCrewSharePublic(pool, {
    projectId: 'project-customer-id',
    photoId: existingPhotoId,
    authorizedCompanyId: 'co-a',
    actor: TEST_ACTOR,
    isPublic: false,
  });
  const afterHide = await listCustomerCrewPhotos(pool, 'cust-a');
  assert.equal(afterHide.shares.find(share => share.id === existingPhotoId).is_public, false);
  const originalId = pool.photos[0].id;
  await publishCrewPhotos(pool, {
    projectId: 'project-customer-id',
    customerId: 'cust-a',
    photos: [{ media_id: 'media-a' }],
  }, { imageValidationOptions });
  assert.equal(pool.photos[0].id, originalId, 'republish keeps the unique row ID');
  assert.equal(pool.photos[0].is_public, true, 'republish re-enables a hidden share');
  assert.equal(pool.photos[0].caption, 'Homeowner caption', 'omitted caption preserves existing caption');
  assert.equal(pool.photos[0].milestone, 'build_complete', 'omitted milestone preserves existing milestone');
  await publishCrewPhotos(pool, {
    projectId: 'project-customer-id',
    customerId: 'cust-a',
    photos: [{ media_id: 'media-a', caption: 'Updated caption', milestone: 'final_invoice' }],
  }, { imageValidationOptions });
  assert.equal(pool.photos[0].caption, 'Updated caption');
  assert.equal(pool.photos[0].milestone, 'final_invoice');
  await publishCrewPhotos(pool, {
    projectId: 'project-customer-id',
    customerId: 'cust-a',
    photos: [{ media_id: 'media-a', caption: '', milestone: '' }],
  }, { imageValidationOptions });
  assert.equal(pool.photos[0].caption, null, 'explicit empty caption clears the existing caption');
  assert.equal(pool.photos[0].milestone, null, 'explicit empty milestone clears the existing milestone');
  const relinkPool = new MemoryPool();
  await publishCrewPhotos(relinkPool, {
    projectId: 'project-customer-id',
    customerId: 'cust-a',
    photos: [{ media_id: 'media-a' }],
  }, { imageValidationOptions });
  relinkPool.projects.find(project => project.id === 'project-customer-id').related_customer_id = 'cust-b';
  const formerCustomerGallery = await listCustomerCrewPhotos(relinkPool, 'cust-a');
  const newCustomerGallery = await listCustomerCrewPhotos(relinkPool, 'cust-b');
  assert.equal(formerCustomerGallery.projects.some(project => project.id === 'project-customer-id'), false);
  assert.equal(newCustomerGallery.projects.some(project => project.id === 'project-customer-id'), true);
  assert.equal(newCustomerGallery.shares.some(share => share.source_media_id === 'media-a'), false,
    'project relinking never transfers the original customer’s crew share');
  const portalSql = `${fs.readFileSync(path.join(__dirname, '..', 'prod-server.cjs'), 'utf8')}\n${fs.readFileSync(path.join(__dirname, '..', 'vite-functions-plugin.js'), 'utf8')}`;
  assert.match(portalSql, /project_photos[\s\S]{0,800}pp\.is_public = true OR pp\.uploaded_by LIKE 'homeowner:%'/);
  assert.match(portalSql, /UPDATE project_photos pp[\s\S]{0,300}pp\.company_id = \$4[\s\S]{0,350}RETURNING pp\.id/);
  assert.match(portalSql, /pp\.source_customer_id = \$3/);
  assert.match(portalSql, /pp\.company_id = \$2/);
  assert.match(portalSql, /COALESCE\(NULLIF\(related_customer_id, ''\), NULLIF\(data->>'related_customer_id', ''\), NULLIF\(customer_id, ''\), NULLIF\(data->>'customer_id', ''\)\)/);
  assert.ok((portalSql.match(/AND COALESCE\(NULLIF\(related_customer_id, ''\), NULLIF\(data->>'related_customer_id', ''\), NULLIF\(customer_id, ''\), NULLIF\(data->>'customer_id', ''\)\) = \$2 AND status != 'cancelled'/g) || []).length >= 2);
  assert.match(portalSql, /Crew photo sharing changes are not permitted during impersonation/);
  const prodSchema = fs.readFileSync(path.join(__dirname, '..', 'db', 'prod-db.cjs'), 'utf8');
  assert.match(prodSchema, /ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_type TEXT/);
  assert.match(prodSchema, /ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_milestone TEXT/);
  assert.match(prodSchema, /ALTER TABLE project_photos ADD COLUMN IF NOT EXISTS source_customer_id TEXT/);

  await fsp.rm(uploadsDir, { recursive: true, force: true });
  console.log('Crew photo sharing tests passed (scope, image verification, atomic publish, re-publish, canonical links, hide, portal visibility).');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});