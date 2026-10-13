'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const delivery = require('../lib/inspectionReportDelivery.cjs');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const PDF = Buffer.from('%PDF-1.7\nsample report\n%%EOF\n');
const JOB = {
  id: 'job-123',
  company_id: 'company-123',
  data: {
    client_name: 'Test Client',
    property_address: '10 Test Street',
    client_email: 'client@example.test',
  },
};
const REPORT = {
  id: 'report-123',
  company_id: 'company-123',
  data: {
    inspection_job_id: JOB.id,
    storage_key: `inspection-reports/${JOB.company_id}/${JOB.id}/report-123.pdf`,
  },
};
const CALLER = { email: 'staff@example.test' };
const MEDIA = {
  id: 'media-123',
  company_id: JOB.company_id,
  data: {
    company_id: JOB.company_id,
    related_entity_id: JOB.id,
    file_type: 'photo',
    file_url: '/uploads/inspection-photo.jpg',
  },
};

function makeRequest(body = PDF, contentType = 'application/pdf', options = {}) {
  const req = new EventEmitter();
  req.headers = { 'content-type': contentType };
  if (options.noLength !== true) req.headers['content-length'] = String(body.length);
  setImmediate(() => {
    req.emit('data', body);
    req.emit('end');
  });
  return req;
}

function makePool({ authorized = true, revoked = false, jobCompanyId = JOB.company_id, fileBuffer = null, fileBytes = null } = {}) {
  const accessRows = new Map();
  const emailRows = new Map();
  const queries = [];
  return {
    queries,
    accessRows,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("entity_type = 'InspectionJob'")) {
        return { rows: [{ ...JOB, company_id: jobCompanyId }] };
      }
      if (sql.includes("entity_type = 'JobMedia'")) {
        return params[1] === MEDIA.company_id ? { rows: [{ ...MEDIA }] } : { rows: [] };
      }
      if (sql.includes('FROM file_uploads')) {
        assert.equal(params[0], 'inspection-photo.jpg');
        assert.equal(params[1], delivery.MAX_PHOTO_BYTES);
        return { rows: fileBuffer
          ? [{ byte_count: fileBytes ?? fileBuffer.length, file_data: (fileBytes ?? fileBuffer.length) <= params[1] ? fileBuffer : null }]
          : [] };
      }
      if (sql.includes('SELECT 1') && sql.includes('staff_profiles')) {
        return { rowCount: authorized ? 1 : 0, rows: authorized ? [{}] : [] };
      }
      if (sql.includes('SELECT id, company_id, data') && params[1] === 'InspectionReportAccess') {
        const row = accessRows.get(params[0]);
        if (!row) return { rows: [] };
        return {
          rows: [{
            id: row.id,
            company_id: row.company_id,
            data: { ...row.data, ...(revoked ? { revoked: true } : {}) },
          }],
        };
      }
      if (sql.includes('SELECT id, company_id, data') && params[1] === 'InspectionReportFile') {
        return params[2] === REPORT.company_id
          ? { rows: [{ ...REPORT, company_id: REPORT.company_id }] }
          : { rows: [] };
      }
      if (sql.includes('SELECT name, phone, email, created_by FROM companies')) {
        return { rows: [{ name: 'Test Company', email: 'office@example.test' }] };
      }
      if (sql.includes('SELECT user_email FROM staff_profiles')) return { rows: [] };
      if (sql.includes('INSERT INTO generic_entities')) {
        const id = params[0];
        const entityType = params[1];
        const companyId = params[2];
        const data = typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3];
        if (entityType === 'InspectionReportAccess') {
          accessRows.set(id, { id, company_id: companyId, data });
        }
        if (entityType === 'InspectionReportEmail' && !emailRows.has(id)) {
          emailRows.set(id, { id, company_id: companyId, data });
        }
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('UPDATE generic_entities') && params[1] === 'InspectionReportEmail' && sql.includes("data->>'claim_token'")) {
        const row = emailRows.get(params[0]);
        if (row && row.data.claim_token === params[4]) {
          row.data = { ...row.data, ...JSON.parse(params[3]) };
          return { rowCount: 1, rows: [{ id: row.id, data: row.data }] };
        }
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('UPDATE generic_entities') && params[1] === 'InspectionReportEmail') {
        const row = emailRows.get(params[0]);
        if (row && row.data.status !== 'submitted' && row.data.status !== 'sending') {
          row.data = { ...row.data, ...JSON.parse(params[3]) };
          return { rowCount: 1, rows: [{ id: row.id, data: row.data }] };
        }
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT id, data FROM generic_entities') && params[1] === 'InspectionReportEmail') {
        const row = emailRows.get(params[0]);
        return { rows: row ? [{ id: row.id, data: row.data }] : [] };
      }
      if (sql.includes('UPDATE generic_entities') && params[1] === 'InspectionReportAccess') {
        const row = accessRows.get(params[0]);
        if (row) row.data.revoked = true;
        return { rowCount: row ? 1 : 0, rows: [] };
      }
      throw new Error(`Unexpected test SQL: ${sql}`);
    },
  };
}

async function testPdfValidationAndUpload() {
  assert.equal(delivery.validatePdfBuffer(PDF), PDF);
  assert.throws(() => delivery.validatePdfBuffer(Buffer.from('<html>not a pdf</html>')), /not a valid PDF/);
  assert.throws(() => delivery.validatePdfBuffer(Buffer.from('%PDF-1.7\nbody without eof')), /incomplete/);
  assert.equal(delivery.MAX_PDF_BYTES, 48 * 1024 * 1024);
  const maxPdf = Buffer.alloc(delivery.MAX_PDF_BYTES);
  Buffer.from('%PDF-1.7').copy(maxPdf);
  Buffer.from('%%EOF').copy(maxPdf, maxPdf.length - 5);
  assert.equal(delivery.validatePdfBuffer(maxPdf), maxPdf);
  assert.throws(() => delivery.validatePdfBuffer(Buffer.concat([maxPdf, Buffer.from('x')])), /48 MiB/);

  const pool = makePool();
  let uploaded;
  const result = await delivery.uploadInspectionReport({
    req: makeRequest(),
    pool,
    caller: CALLER,
    jobId: JOB.id,
    storage: {
      async uploadPrivateObject(key, buffer, contentType) {
        uploaded = { key, buffer, contentType };
      },
    },
  });
  assert.match(result.reportId, /^[0-9a-f-]{36}$/i);
  assert.equal(uploaded.contentType, 'application/pdf');
  assert.deepEqual(uploaded.buffer, PDF);
  assert.match(uploaded.key, /^inspection-reports\/company-123\/job-123\//);
  assert.ok(pool.queries.some(({ sql }) => sql.includes('INSERT INTO generic_entities')));
}

async function testUploadAuthorizationAndContentType() {
  await assert.rejects(
    delivery.uploadInspectionReport({
      req: makeRequest(),
      pool: makePool({ authorized: false }),
      caller: CALLER,
      jobId: JOB.id,
      storage: { uploadPrivateObject: async () => assert.fail('must not upload an unauthorized report') },
    }),
    (error) => error.statusCode === 403,
  );
  const tooLargeDeclared = makeRequest(PDF);
  tooLargeDeclared.headers['content-length'] = String(delivery.MAX_PDF_BYTES + 1);
  await assert.rejects(delivery.readPdfBody(tooLargeDeclared), (error) => error.statusCode === 413);
  const unboundedRequest = makeRequest(Buffer.alloc(delivery.MAX_PDF_BYTES + 1), 'application/pdf', { noLength: true });
  await assert.rejects(delivery.readPdfBody(unboundedRequest), (error) => error.statusCode === 413);
  await assert.rejects(
    delivery.uploadInspectionReport({
      req: makeRequest(PDF, 'text/plain'),
      pool: makePool(),
      caller: CALLER,
      jobId: JOB.id,
      storage: { uploadPrivateObject: async () => assert.fail('must reject non-PDF content') },
    }),
    (error) => error.statusCode === 415,
  );
  await assert.rejects(
    delivery.uploadInspectionReport({
      req: makeRequest(),
      pool: makePool(),
      caller: CALLER,
      jobId: null,
    }),
    (error) => error.statusCode === 400,
  );
}

async function testAuthorizedPhotoResizing() {
  const sourceCanvas = createCanvas(1800, 900);
  const sourceContext = sourceCanvas.getContext('2d');
  sourceContext.fillStyle = '#cc3344';
  sourceContext.fillRect(0, 0, 1800, 900);
  const source = sourceCanvas.toBuffer('image/png');
  assert.deepEqual(delivery.readSafeImageDimensions(source), { width: 1800, height: 900 });
  assert.deepEqual(delivery.readSafeImageDimensions(sourceCanvas.toBuffer('image/jpeg', 80)), { width: 1800, height: 900 });
  const pool = makePool();
  let storageFilename;
  const storage = {
    async downloadFromObjectStorageBounded(filename, options) {
      storageFilename = filename;
      assert.equal(options.maxBytes, delivery.MAX_PHOTO_BYTES);
      return source;
    },
  };
  const jpeg = await delivery.getInspectionJobPhoto({
    pool, caller: CALLER, jobId: JOB.id, mediaId: MEDIA.id, storage,
  });
  assert.equal(jpeg.subarray(0, 3).toString('hex'), 'ffd8ff');
  assert.ok(jpeg.length <= 2 * 1024 * 1024);
  const decoded = await loadImage(jpeg);
  assert.equal(decoded.width, 1200);
  assert.equal(decoded.height, 600);
  assert.equal(storageFilename, 'inspection-photo.jpg');
  const legacyObjectPool = makePool();
  const legacyObjectQuery = legacyObjectPool.query.bind(legacyObjectPool);
  legacyObjectPool.query = (sql, params) => sql.includes("entity_type = 'JobMedia'")
    ? Promise.resolve({ rows: [{ ...MEDIA, data: { ...MEDIA.data, file_url: 'https://example.test/replit-objstore-old/public/inspection-photo.jpg' } }] })
    : legacyObjectQuery(sql, params);
  await delivery.getInspectionJobPhoto({
    pool: legacyObjectPool, caller: CALLER, jobId: JOB.id, mediaId: MEDIA.id, storage,
  });
  assert.equal(storageFilename, 'inspection-photo.jpg');
  const dbFallback = await delivery.getInspectionJobPhoto({
    pool: makePool({ fileBuffer: source }), caller: CALLER, jobId: JOB.id, mediaId: MEDIA.id,
    storage: { downloadFromObjectStorageBounded: async () => null }, diskDirs: [],
  });
  assert.equal((await loadImage(dbFallback)).width, 1200);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-photo-'));
  try {
    fs.writeFileSync(path.join(tempDir, 'inspection-photo.jpg'), source);
    const diskFallback = await delivery.getInspectionJobPhoto({
      pool: makePool(), caller: CALLER, jobId: JOB.id, mediaId: MEDIA.id,
      storage: { downloadFromObjectStorageBounded: async () => null }, diskDirs: [tempDir],
    });
    assert.equal((await loadImage(diskFallback)).width, 1200);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  await assert.rejects(
    delivery.getInspectionJobPhoto({
      pool: makePool({ fileBuffer: source, fileBytes: delivery.MAX_PHOTO_BYTES + 1 }),
      caller: CALLER, jobId: JOB.id, mediaId: MEDIA.id,
      storage: { downloadFromObjectStorageBounded: async () => null }, diskDirs: [],
    }),
    error => error.statusCode === 413,
  );
  const noiseCanvas = createCanvas(1800, 900);
  const noiseContext = noiseCanvas.getContext('2d');
  const noisePixels = noiseContext.createImageData(1800, 900);
  let seed = 12345;
  for (let i = 0; i < noisePixels.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    noisePixels.data[i] = seed & 255;
    noisePixels.data[i + 1] = (seed >>> 8) & 255;
    noisePixels.data[i + 2] = (seed >>> 16) & 255;
    noisePixels.data[i + 3] = 255;
  }
  noiseContext.putImageData(noisePixels, 0, 0);
  const noisySource = noiseCanvas.toBuffer('image/png');
  const largeReportPhoto = await delivery.getInspectionJobPhoto({
    pool, caller: CALLER, jobId: JOB.id, mediaId: MEDIA.id, photoCount: 179,
    storage: { downloadFromObjectStorageBounded: async () => noisySource },
  });
  assert.ok(largeReportPhoto.length <= Math.floor(36 * 1024 * 1024 / 179));
  assert.ok((await loadImage(largeReportPhoto)).width >= 840);

  const legacyPool = makePool();
  legacyPool.query = async (sql, params = []) => {
    if (sql.includes("entity_type = 'InspectionJob'")) return { rows: [{ ...JOB }] };
    if (sql.includes('SELECT 1') && sql.includes('staff_profiles')) return { rowCount: 1, rows: [{}] };
    if (sql.includes("entity_type = 'JobMedia'")) {
      return { rows: [{ ...MEDIA, data: { ...MEDIA.data, file_url: 'https://legacy.example.test/uploads/inspection-photo.jpg' } }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  await delivery.getInspectionJobPhoto({
    pool: legacyPool, caller: CALLER, jobId: JOB.id, mediaId: MEDIA.id, storage,
  });
  assert.equal(storageFilename, 'inspection-photo.jpg');
  for (const fileUrl of ['/uploads/../secret.jpg', 'https://127.0.0.1/private']) {
    const invalidPool = makePool();
    invalidPool.query = async (sql, params = []) => {
      if (sql.includes("entity_type = 'InspectionJob'")) return { rows: [{ ...JOB }] };
      if (sql.includes('SELECT 1') && sql.includes('staff_profiles')) return { rowCount: 1, rows: [{}] };
      if (sql.includes("entity_type = 'JobMedia'")) return { rows: [{ ...MEDIA, data: { ...MEDIA.data, file_url: fileUrl } }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    };
    await assert.rejects(
      delivery.getInspectionJobPhoto({ pool: invalidPool, caller: CALLER, jobId: JOB.id, mediaId: MEDIA.id, storage }),
      (error) => error.statusCode === 404,
    );
  }
  const missingStorage = { downloadFromObjectStorageBounded: async () => null };
  await assert.rejects(
    delivery.getInspectionJobPhoto({ pool, caller: CALLER, jobId: JOB.id, mediaId: 'missing-media', storage: missingStorage }),
    (error) => error.statusCode === 404,
  );
  const mismatched = makePool();
  mismatched.query = async (sql, params = []) => {
    if (sql.includes("entity_type = 'InspectionJob'")) return { rows: [{ ...JOB }] };
    if (sql.includes('SELECT 1') && sql.includes('staff_profiles')) return { rowCount: 1, rows: [{}] };
    if (sql.includes("entity_type = 'JobMedia'")) {
      return { rows: [{ ...MEDIA, data: { ...MEDIA.data, related_entity_id: 'another-job' } }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  await assert.rejects(
    delivery.getInspectionJobPhoto({ pool: mismatched, caller: CALLER, jobId: JOB.id, mediaId: MEDIA.id, storage }),
    (error) => error.statusCode === 404,
  );
  const devRoutes = fs.readFileSync('vite-functions-plugin.js', 'utf8');
  const prodRoutes = fs.readFileSync('prod-server.cjs', 'utf8');
  for (const routeSource of [devRoutes, prodRoutes]) {
    const routeIndex = routeSource.indexOf("pathname === '/api/inspection-reports/photo'");
    assert.notEqual(routeIndex, -1);
    const photoRoute = routeSource.slice(routeIndex, routeIndex + 1800);
    assert.match(photoRoute, /req\.method !== 'GET'/);
    assert.match(photoRoute, /searchParams\.get\('inspectionJobId'\)/);
    assert.match(photoRoute, /searchParams\.get\('mediaId'\)/);
    assert.match(photoRoute, /handlePhotoRoute/);
  }
}

async function testScopedExpiringAndRevocableLinks() {
  const priorSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'inspection-report-test-secret';
  try {
    const pool = makePool();
    const link = await delivery.createRecipientReportLink({
      pool,
      report: REPORT,
      job: { id: JOB.id, companyId: JOB.company_id },
      recipientEmail: 'client@example.test',
      origin: 'https://reports.example.test',
    });
    const token = new URL(link.url).searchParams.get('token');
    assert.ok(token);
    assert.match(link.url, /^https:\/\/reports\.example\.test\/api\/inspection-reports\/download\?/);
    assert.equal((await delivery.loadAccessForDownload(pool, token)).access.id, link.accessId);

    const tampered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
    await assert.rejects(delivery.loadAccessForDownload(pool, tampered), (error) => error.statusCode === 404);
    const revocation = await delivery.revokeInspectionReportLinks({
      params: { inspectionJobId: JOB.id, accessIds: [link.accessId] },
      pool,
      caller: CALLER,
    });
    assert.equal(revocation.revoked_count, 1);
    await assert.rejects(delivery.loadAccessForDownload(pool, token), (error) => error.statusCode === 404);

    const expiredAt = Date.now() - 1000;
    const expiredId = 'd147a8b3-d914-4aab-86cd-3533c8cfe421';
    const expiredToken = delivery.makeSignedAccessToken({
      accessId: expiredId,
      expiresAt: expiredAt,
      companyId: JOB.company_id,
      jobId: JOB.id,
      reportId: REPORT.id,
    });
    await assert.rejects(delivery.loadAccessForDownload(pool, expiredToken), (error) => error.statusCode === 404);

    const wrongCompanyPool = makePool({ jobCompanyId: 'different-company' });
    const wrongLink = await delivery.createRecipientReportLink({
      pool: wrongCompanyPool,
      report: REPORT,
      job: { id: JOB.id, companyId: JOB.company_id },
      recipientEmail: 'client@example.test',
      origin: 'https://reports.example.test',
    });
    const wrongToken = new URL(wrongLink.url).searchParams.get('token');
    await assert.rejects(
      delivery.loadAccessForDownload(wrongCompanyPool, wrongToken),
      (error) => error.statusCode === 404,
    );
  } finally {
    if (priorSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = priorSecret;
  }
}

async function testPrivateDownloadHeaders() {
  const priorSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'inspection-report-download-test-secret';
  try {
    const pool = makePool();
    const link = await delivery.createRecipientReportLink({
      pool,
      report: REPORT,
      job: { id: JOB.id, companyId: JOB.company_id },
      recipientEmail: 'client@example.test',
      origin: 'https://reports.example.test',
    });
    const token = new URL(link.url).searchParams.get('token');
    const response = {
      headers: null,
      status: null,
      body: null,
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body) { this.body = body; },
    };
    await delivery.handleDownloadRoute({ headers: {} }, response, {
      pool,
      token,
      storage: { downloadPrivateObject: async () => PDF },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers['Content-Type'], 'application/pdf');
    assert.match(response.headers['Content-Disposition'], /^attachment;/);
    assert.match(response.headers['Cache-Control'], /no-store/);
    assert.deepEqual(response.body, PDF);
  } finally {
    if (priorSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = priorSecret;
  }
}

async function testPhotoRouteBinaryHeaders() {
  const image = createCanvas(20, 10).toBuffer('image/png');
  const response = {
    headers: null, status: null, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
  await delivery.handlePhotoRoute({ headers: {} }, response, {
    pool: makePool(),
    caller: CALLER,
    jobId: JOB.id,
    mediaId: MEDIA.id,
    storage: { downloadFromObjectStorageBounded: async () => image },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers['Content-Type'], 'image/jpeg');
  assert.match(response.headers['Cache-Control'], /no-store/);
  assert.equal(response.body.subarray(0, 3).toString('hex'), 'ffd8ff');
}

async function testEmailSubmissionStatusAndTenantAttribution() {
  const pool = makePool();
  let sentMessage;
  const result = await delivery.sendInspectionReportEmails({
    params: { inspectionJobId: JOB.id, reportId: REPORT.id, sendToClient: true },
    req: { headers: { host: 'app.example.test' } },
    pool,
    caller: CALLER,
    origin: 'https://app.example.test',
    sendEmail: async (message) => {
      sentMessage = message;
      return { success: true, provider: 'smtp', id: 'smtp-message-id' };
    },
  });
  assert.equal(result.status, 'submitted');
  assert.ok(pool.queries.some(({ sql }) => sql.includes('ON CONFLICT (id, entity_type) DO NOTHING')));
  assert.equal(result.submitted_count, 1);
  assert.equal(result.client_submitted, true);
  assert.equal(sentMessage.context.companyId, JOB.company_id);
  assert.equal(sentMessage.context.actorEmail, CALLER.email);
  assert.match(sentMessage.html, /72 hours/);
  assert.match(sentMessage.context.idempotencyKey, /^[0-9a-f-]{36}$/i);
  assert.doesNotMatch(sentMessage.html, /<script>/i);
  let duplicateSendCount = 0;
  const duplicate = await delivery.sendInspectionReportEmails({
    params: { inspectionJobId: JOB.id, reportId: REPORT.id, sendToClient: true },
    req: { headers: { host: 'app.example.test' } },
    pool,
    caller: CALLER,
    origin: 'https://app.example.test',
    sendEmail: async () => { duplicateSendCount++; return { success: true }; },
  });
  assert.equal(duplicate.status, 'submitted');
  assert.equal(duplicate.recipient_results[0].reused, true);
  assert.equal(duplicateSendCount, 0);

  const failedPool = makePool();
  const failed = await delivery.sendInspectionReportEmails({
    params: { inspectionJobId: JOB.id, reportId: REPORT.id, sendToClient: true },
    req: { headers: { host: 'app.example.test' } },
    pool: failedPool,
    caller: CALLER,
    origin: 'https://app.example.test',
    sendEmail: async () => ({ success: false }),
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failed_count, 1);
  assert.ok(failedPool.queries.some(({ sql }) => sql.includes('UPDATE generic_entities')));
  const retried = await delivery.sendInspectionReportEmails({
    params: { inspectionJobId: JOB.id, reportId: REPORT.id, sendToClient: true },
    req: { headers: { host: 'app.example.test' } },
    pool: failedPool,
    caller: CALLER,
    origin: 'https://app.example.test',
    sendEmail: async () => ({ success: true, provider: 'smtp', id: 'retry-message' }),
  });
  assert.equal(retried.status, 'submitted');

  const uncertainPool = makePool();
  const uncertainQuery = uncertainPool.query.bind(uncertainPool);
  uncertainPool.query = (sql, params) => {
    if (sql.includes('UPDATE generic_entities') && sql.includes("data->>'claim_token'")) {
      return Promise.resolve({ rowCount: 0, rows: [] });
    }
    return uncertainQuery(sql, params);
  };
  let acceptedCount = 0;
  const sendParams = { inspectionJobId: JOB.id, reportId: REPORT.id, sendToClient: true };
  const sendOptions = {
    params: sendParams, req: { headers: { host: 'app.example.test' } },
    pool: uncertainPool, caller: CALLER, origin: 'https://app.example.test',
  };
  const uncertain = await delivery.sendInspectionReportEmails({
    ...sendOptions,
    sendEmail: async () => { acceptedCount++; return { success: true, id: 'accepted-but-unrecorded' }; },
  });
  assert.equal(uncertain.status, 'failed');
  assert.match(uncertain.error, /uncertain/);
  assert.equal(uncertainPool.accessRows.size, 1, 'the emailed link must remain valid');
  assert.ok(uncertainPool.queries.some(({ sql }) => sql.includes("data->>'status' IS DISTINCT FROM 'sending'") && !sql.includes("lease_until')::timestamptz")));
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 4 * 60 * 1000;
    const noDuplicate = await delivery.sendInspectionReportEmails({
      ...sendOptions, sendEmail: async () => { acceptedCount++; return { success: true }; },
    });
    assert.equal(noDuplicate.status, 'failed');
    assert.match(noDuplicate.error, /uncertain/);
    assert.equal(acceptedCount, 1, 'expired lease must not resend an accepted message');
  } finally {
    Date.now = originalNow;
  }

  const timeoutPool = makePool();
  let attemptedCount = 0;
  const timeoutOptions = { ...sendOptions, pool: timeoutPool };
  const timedOut = await delivery.sendInspectionReportEmails({
    ...timeoutOptions, sendEmail: async () => { attemptedCount++; throw new Error('provider timeout'); },
  });
  assert.match(timedOut.error, /uncertain/);
  assert.equal(timeoutPool.accessRows.size, 1);
  await delivery.sendInspectionReportEmails({
    ...timeoutOptions, sendEmail: async () => { attemptedCount++; return { success: true }; },
  });
  assert.equal(attemptedCount, 1, 'provider timeout may have accepted mail and must not resend');
}

function testOriginValidation() {
  const envKeys = ['VITE_REPLIT_APP_URL', 'PUBLIC_APP_URL', 'REPLIT_DEV_DOMAIN', 'REPLIT_DEPLOYMENT'];
  const prior = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of envKeys) delete process.env[key];
    process.env.REPLIT_DEPLOYMENT = '1';
    assert.equal(
      delivery.getRequestOrigin({ headers: { host: 'good.example.test' } }),
      'https://good.example.test',
    );
    assert.throws(
      () => delivery.getRequestOrigin({ headers: { host: 'good.example.test@evil.example.test' } }),
      /request host/,
    );
  } finally {
    for (const key of envKeys) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
}

async function main() {
  await testPdfValidationAndUpload();
  await testUploadAuthorizationAndContentType();
  await testAuthorizedPhotoResizing();
  await testScopedExpiringAndRevocableLinks();
  await testPrivateDownloadHeaders();
  await testPhotoRouteBinaryHeaders();
  await testEmailSubmissionStatusAndTenantAttribution();
  testOriginValidation();
  console.log('Inspection report delivery checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});