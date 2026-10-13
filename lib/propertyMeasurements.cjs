const crypto = require('crypto');
const { fetchWithRetry } = require('./fetchWithRetry.cjs');

const MAX_PHOTOS = 12;
const MAX_PHOTO_URL_LENGTH = 2048;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const GEMINI_MODEL = 'gemini-2.5-flash';

class PropertyMeasurementError extends Error {
  constructor(message, statusCode = 400, code = 'PROPERTY_MEASUREMENT_ERROR') {
    super(message);
    this.name = 'PropertyMeasurementError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizePhotoUrls(value) {
  const urls = Array.isArray(value) ? value : [];
  const unique = [];
  const seen = new Set();
  for (const raw of urls) {
    if (typeof raw !== 'string') continue;
    const url = raw.trim();
    if (!url || url.length > MAX_PHOTO_URL_LENGTH || seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
  }
  if (unique.length < 2) {
    throw new PropertyMeasurementError('Upload at least two exterior photos from different angles.');
  }
  if (unique.length > MAX_PHOTOS) {
    throw new PropertyMeasurementError(`You can analyze up to ${MAX_PHOTOS} exterior photos at a time.`);
  }
  return unique;
}

function validatePhotoUrl(rawUrl) {
  if (rawUrl.startsWith('/')) return rawUrl;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new PropertyMeasurementError('One of the uploaded photo links is invalid.');
  }
  if (parsed.protocol !== 'https:') {
    throw new PropertyMeasurementError('Photo links must use HTTPS.');
  }
  return parsed.toString();
}

function detectImageMime(buffer) {
  if (buffer?.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer?.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer?.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer?.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12).toLowerCase();
    if (brand.startsWith('hei') || brand.startsWith('hev') || brand === 'mif1' || brand === 'msf1') return 'image/heic';
  }
  if (buffer?.length >= 3 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  // Do not trust Content-Type from the uploaded URL. A mislabeled or hostile
  // response must fail closed rather than being sent to Gemini as an image.
  return null;
}

function resolvePhotoUrl(rawUrl, requestBaseUrl) {
  if (!rawUrl.startsWith('/')) return rawUrl;
  const base = String(requestBaseUrl || process.env.VITE_REPLIT_APP_URL || process.env.PUBLIC_APP_URL || '').replace(/\/+$/, '');
  if (!base) throw new PropertyMeasurementError('The photo host is not configured.', 500, 'PHOTO_HOST_NOT_CONFIGURED');
  return `${base}${rawUrl}`;
}

async function fetchImageAsBase64(rawUrl, requestBaseUrl) {
  const target = resolvePhotoUrl(rawUrl, requestBaseUrl);
  let response;
  try {
    response = await fetch(target, { signal: AbortSignal.timeout(20000) });
  } catch (error) {
    throw new PropertyMeasurementError(`Could not load an uploaded photo (${error.name === 'TimeoutError' ? 'timed out' : 'network error'}). Please try again.`, 422, 'PHOTO_LOAD_FAILED');
  }
  if (!response.ok) {
    throw new PropertyMeasurementError(`Could not load an uploaded photo (HTTP ${response.status}). Please re-upload it.`, 422, 'PHOTO_LOAD_FAILED');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new PropertyMeasurementError('One uploaded photo is empty. Please re-upload it.', 422, 'PHOTO_EMPTY');
  if (buffer.length > MAX_IMAGE_BYTES) throw new PropertyMeasurementError('Each photo must be 12 MB or smaller.', 413, 'PHOTO_TOO_LARGE');
  const mimeType = detectImageMime(buffer);
  if (!mimeType) throw new PropertyMeasurementError('One uploaded file is not a supported image. Use JPG, PNG, WebP, HEIC, or GIF.', 422, 'PHOTO_INVALID');
  return { inlineData: { mimeType, data: buffer.toString('base64') } };
}

const SYSTEM_INSTRUCTION = `You are a careful residential exterior estimator reviewing multiple real-world house photos.

Your measurements are planning estimates, not a substitute for a field measurement report. Use visible scale references such as standard doors, windows, siding courses, and known building proportions. Reconcile overlapping views and do not add the same wall twice. If a dimension cannot be responsibly inferred from the photos, return null rather than inventing precision.

Return only the requested JSON object. All numeric dimensions must be numbers or null. Use siding square footage as net wall siding area after deducting visibly countable windows and doors. Use trim linear footage for visible exterior trim such as fascia, soffit/eave trim, rake trim, corner posts, and window/door trim; report the aggregate visible linear footage and explain the included scope. Roof pitch must be a conventional ratio string such as "6/12" or null. Counts must be whole numbers or null.`;

function buildPrompt(photoCount) {
  return `Analyze these ${photoCount} exterior house photos as one property.

Return exactly this JSON shape:
{
  "property_type": "single_family" | "townhome" | "multi_family" | "garage" | "other" | null,
  "measurements": {
    "siding_sq": number | null,
    "trim_linear_ft": number | null,
    "roof_pitch": string | null,
    "window_count": integer | null,
    "door_count": integer | null
  },
  "breakdown": {
    "wall_area_sq_ft_gross": number | null,
    "openings_deducted_sq_ft": number | null,
    "siding_area_sq_ft_net": number | null,
    "fascia_linear_ft": number | null,
    "soffit_linear_ft": number | null,
    "rake_linear_ft": number | null,
    "corner_post_linear_ft": number | null,
    "window_door_trim_linear_ft": number | null,
    "assumptions": string[]
  },
  "photo_observations": [
    {
      "photo_index": integer,
      "angle": "front" | "rear" | "left" | "right" | "corner" | "other",
      "visible_features": string,
      "confidence": number
    }
  ],
  "confidence": number,
  "uncertainty_flags": string[],
  "notes": string
}

Xactimate-style measurement rules:
- 1 siding square = 100 square feet. Calculate siding_sq from net siding_area_sq_ft / 100 and round to two decimals.
- Do not count roof area as siding. Do not count patios, decks, fences, detached structures, or landscaping unless clearly part of the primary exterior and identified.
- Count windows and exterior doors only when visually identifiable; do not infer hidden elevations.
- If roof pitch is not directly visible from a gable/eave relationship, return null and say why.
- Confidence is 0-100. Keep photo_observations aligned with the supplied image order.

Use the field "notes" for scope limitations and assumptions, not fabricated exactness.`;
}

function extractGeminiText(payload) {
  return payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('').trim() || '';
}

function parseJsonResponse(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
    }
  }
  throw new PropertyMeasurementError('Vision returned an unreadable measurement response. Please try the photos again.', 502, 'VISION_INVALID_JSON');
}

function finiteOrNull(value, { integer = false, min = 0, max = 100000 } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) return null;
  return number;
}

function normalizeAnalysis(raw) {
  const measurements = raw?.measurements || {};
  const breakdown = raw?.breakdown || {};
  const photoObservations = Array.isArray(raw?.photo_observations) ? raw.photo_observations.slice(0, MAX_PHOTOS).map((item, index) => ({
    photo_index: finiteOrNull(item?.photo_index, { integer: true, min: 0, max: MAX_PHOTOS - 1 }) ?? index,
    angle: typeof item?.angle === 'string' ? item.angle.slice(0, 40) : 'other',
    visible_features: typeof item?.visible_features === 'string' ? item.visible_features.slice(0, 500) : '',
    confidence: finiteOrNull(item?.confidence, { min: 0, max: 100 }) ?? 0,
  })) : [];
  const normalized = {
    property_type: typeof raw?.property_type === 'string' ? raw.property_type.slice(0, 40) : null,
    measurements: {
      siding_sq: finiteOrNull(measurements.siding_sq, { max: 10000 }),
      trim_linear_ft: finiteOrNull(measurements.trim_linear_ft, { max: 100000 }),
      roof_pitch: typeof measurements.roof_pitch === 'string' ? measurements.roof_pitch.slice(0, 20) : null,
      window_count: finiteOrNull(measurements.window_count, { integer: true, max: 1000 }),
      door_count: finiteOrNull(measurements.door_count, { integer: true, max: 200 }),
    },
    breakdown: {
      wall_area_sq_ft_gross: finiteOrNull(breakdown.wall_area_sq_ft_gross, { max: 100000 }),
      openings_deducted_sq_ft: finiteOrNull(breakdown.openings_deducted_sq_ft, { max: 100000 }),
      siding_area_sq_ft_net: finiteOrNull(breakdown.siding_area_sq_ft_net, { max: 100000 }),
      fascia_linear_ft: finiteOrNull(breakdown.fascia_linear_ft, { max: 100000 }),
      soffit_linear_ft: finiteOrNull(breakdown.soffit_linear_ft, { max: 100000 }),
      rake_linear_ft: finiteOrNull(breakdown.rake_linear_ft, { max: 100000 }),
      corner_post_linear_ft: finiteOrNull(breakdown.corner_post_linear_ft, { max: 100000 }),
      window_door_trim_linear_ft: finiteOrNull(breakdown.window_door_trim_linear_ft, { max: 100000 }),
      assumptions: Array.isArray(breakdown.assumptions) ? breakdown.assumptions.filter((v) => typeof v === 'string').slice(0, 20).map((v) => v.slice(0, 300)) : [],
    },
    photo_observations: photoObservations,
    confidence: finiteOrNull(raw?.confidence, { min: 0, max: 100 }) ?? 0,
    uncertainty_flags: Array.isArray(raw?.uncertainty_flags) ? raw.uncertainty_flags.filter((v) => typeof v === 'string').slice(0, 20).map((v) => v.slice(0, 300)) : [],
    notes: typeof raw?.notes === 'string' ? raw.notes.slice(0, 2000) : '',
  };
  const coreCount = Object.values(normalized.measurements).filter((value) => value !== null).length;
  if (coreCount === 0) {
    throw new PropertyMeasurementError('Vision could not identify enough measurable exterior features. Add clearer photos from multiple angles.', 422, 'VISION_NO_MEASUREMENTS');
  }
  return normalized;
}

async function assertRelatedRecords(pool, companyId, invoiceId, jobId) {
  if (!invoiceId && !jobId) {
    throw new PropertyMeasurementError('An invoice_id or job_id is required.');
  }
  if (invoiceId) {
    const invoice = await pool.query('SELECT id FROM invoices WHERE id = $1 AND company_id = $2 LIMIT 1', [String(invoiceId), companyId]);
    if (!invoice.rowCount) throw new PropertyMeasurementError('Invoice not found for this company.', 404, 'INVOICE_NOT_FOUND');
  }
  if (jobId) {
    const job = await pool.query(
      `SELECT id FROM generic_entities WHERE id = $1 AND entity_type = 'InspectionJob' AND company_id = $2 LIMIT 1`,
      [String(jobId), companyId],
    );
    if (!job.rowCount) throw new PropertyMeasurementError('Job not found for this company.', 404, 'JOB_NOT_FOUND');
  }
}

async function resolveMeasurementCompany({ pool, caller, requestedCompanyId = null, invoiceId = null, jobId = null }) {
  if (!caller?.email) throw new PropertyMeasurementError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  let companyId = null;
  if (invoiceId) {
    const result = await pool.query('SELECT company_id FROM invoices WHERE id = $1 LIMIT 1', [String(invoiceId)]);
    companyId = result.rows[0]?.company_id || null;
  } else if (jobId) {
    const result = await pool.query(
      `SELECT company_id FROM generic_entities WHERE id = $1 AND entity_type = 'InspectionJob' LIMIT 1`,
      [String(jobId)],
    );
    companyId = result.rows[0]?.company_id || null;
  }
  if (caller.is_super_admin && requestedCompanyId) companyId = String(requestedCompanyId);
  if (!companyId) companyId = caller.company_id || null;
  if (!companyId) throw new PropertyMeasurementError('Company could not be resolved.', 403, 'COMPANY_REQUIRED');
  const membership = await pool.query(
    `SELECT 1 FROM companies c
     WHERE c.id = $1 AND (
       LOWER(COALESCE(c.created_by, '')) = LOWER($2)
       OR EXISTS (
         SELECT 1 FROM staff_profiles sp
         WHERE sp.company_id = c.id
           AND (LOWER(COALESCE(NULLIF(sp.user_email, ''), sp.email)) = LOWER($2))
           AND COALESCE(sp.is_active, true) = true
       )
     )
     LIMIT 1`,
    [companyId, caller.email],
  );
  if (!membership.rowCount && !caller.is_super_admin) {
    throw new PropertyMeasurementError('You do not have access to this company.', 403, 'COMPANY_ACCESS_DENIED');
  }
  return companyId;
}

async function analyzePropertyPhotos({
  pool,
  companyId,
  invoiceId = null,
  jobId = null,
  photoUrls,
  requestBaseUrl,
  apiKey,
  checkAIUsage,
  logUsageEvent,
  createdBy = null,
}) {
  if (!pool || !companyId) throw new PropertyMeasurementError('A company could not be resolved.', 403, 'COMPANY_REQUIRED');
  if (!apiKey) throw new PropertyMeasurementError('Vision analysis is not configured. Please contact an administrator.', 503, 'VISION_NOT_CONFIGURED');
  const urls = normalizePhotoUrls(photoUrls).map(validatePhotoUrl);
  await assertRelatedRecords(pool, String(companyId), invoiceId, jobId);

  if (typeof checkAIUsage === 'function') {
    const usage = await checkAIUsage(String(companyId));
    if (!usage?.allowed) throw new PropertyMeasurementError(usage.error || 'AI usage limit reached.', 429, 'AI_USAGE_LIMIT');
  }

  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO property_measurements
      (id, company_id, invoice_id, job_id, photo_urls, raw_analysis, status, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, '{}'::jsonb, 'processing', $6, NOW(), NOW())`,
    [id, String(companyId), invoiceId ? String(invoiceId) : null, jobId ? String(jobId) : null, JSON.stringify(urls), createdBy],
  );

  try {
    const imageParts = [];
    for (const url of urls) imageParts.push(await fetchImageAsBase64(url, requestBaseUrl));
    imageParts.push({ text: buildPrompt(urls.length) });
    const response = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ role: 'user', parts: imageParts }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
      },
      { timeoutMs: 90000, retries: 2 },
    );
    if (!response.ok) {
      throw new PropertyMeasurementError(`Vision API error (${response.status}). Please try again.`, response.status === 429 ? 429 : 502, 'VISION_API_ERROR');
    }
    const payload = await response.json();
    const rawText = extractGeminiText(payload);
    const rawAnalysis = parseJsonResponse(rawText);
    const analysis = normalizeAnalysis(rawAnalysis);
    const m = analysis.measurements;
    await pool.query(
      `UPDATE property_measurements
       SET raw_analysis = $1::jsonb, siding_sq = $2, trim_linear_ft = $3, roof_pitch = $4,
           window_count = $5, door_count = $6, confidence = $7, status = 'completed',
           error_message = NULL, updated_at = NOW()
       WHERE id = $8 AND company_id = $9`,
      [JSON.stringify(rawAnalysis), m.siding_sq, m.trim_linear_ft, m.roof_pitch, m.window_count, m.door_count, analysis.confidence, id, String(companyId)],
    );
    if (typeof logUsageEvent === 'function') logUsageEvent(String(companyId), 'ai_estimator').catch(() => {});
    return { id, ...analysis, photo_urls: urls, status: 'completed' };
  } catch (error) {
    await pool.query(
      `UPDATE property_measurements SET status = 'failed', error_message = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3`,
      [error.message || 'Vision analysis failed.', id, String(companyId)],
    ).catch(() => {});
    throw error;
  }
}

async function listPropertyMeasurements({ pool, companyId, invoiceId = null, jobId = null }) {
  if (!pool || !companyId) throw new PropertyMeasurementError('A company could not be resolved.', 403, 'COMPANY_REQUIRED');
  if (!invoiceId && !jobId) throw new PropertyMeasurementError('An invoice_id or job_id is required.');
  const clauses = ['company_id = $1'];
  const values = [String(companyId)];
  if (invoiceId) {
    values.push(String(invoiceId));
    clauses.push(`invoice_id = $${values.length}`);
  }
  if (jobId) {
    values.push(String(jobId));
    clauses.push(`job_id = $${values.length}`);
  }
  const result = await pool.query(
    `SELECT id, company_id, invoice_id, job_id, photo_urls, raw_analysis,
            siding_sq, trim_linear_ft, roof_pitch, window_count, door_count,
            confidence, status, error_message, created_by, created_at, updated_at
     FROM property_measurements
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 25`,
    values,
  );
  return result.rows;
}

module.exports = {
  MAX_PHOTOS,
  MAX_IMAGE_BYTES,
  PropertyMeasurementError,
  analyzePropertyPhotos,
  listPropertyMeasurements,
  resolveMeasurementCompany,
  normalizeAnalysis,
  normalizePhotoUrls,
  detectImageMime,
  parseJsonResponse,
};