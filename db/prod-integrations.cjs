const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const crypto = require('crypto');
const stormFunctions = require('./storm-functions.cjs');
const objStorage = require('./object-storage.cjs');
const { buildLexiSystemPrompt, getLexiTools } = require('../lib/lexiSystemPrompt.cjs');
const { buildLexiToolFallback } = require('../lib/lexiToolFallback.cjs');
const { requiredReadTool } = require('../lib/lexiReadIntent.cjs');
const { invalidateCallerCache, invalidateCallerCacheForCompany, lookupCallerByCrmPhone } = require('../lib/lookupCallerByCrmPhone.cjs');
const { canonicalizeGenericEntityType, normalizeGenericEntityData } = require('../lib/expenseNormalize.cjs');
const { expandFinancialFollowup } = require('../lib/lexiFollowupContext.cjs');
const { accessDenied: lexiAccessDenied, buildLexiAccessPolicy, canUseCrmDataType, isPermittedRepTool, isRestrictedRepTool, ownRecordCondition } = require('../lib/lexiAccessPolicy.cjs');
const { assertBuildDate, buildDayRange } = require('../lib/buildScheduleTime.cjs');
const { calendarBuildRouteGuard, manageEntityBuildRouteGuard } = require('../lib/lexiBuildIntent.cjs');
const { buildScheduleConfirmationGuard, isBuildSchedulingMutation } = require('../lib/lexiBuildConfirmation.cjs');
const { annotateToolResult: groundToolResult, createGroundingLedger, auditLexiResponse, buildWriteVerificationResult } = require('../lib/lexiGrounding.cjs');

let _stripeClientForInvoiceEmail = null;
async function _getStripeClientForInvoiceEmail() {
  if (_stripeClientForInvoiceEmail) return _stripeClientForInvoiceEmail;
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY
      ? 'repl ' + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
        ? 'depl ' + process.env.WEB_REPL_RENEWAL
        : null;
    if (!xReplitToken || !hostname) return null;
    const url = new URL(`https://${hostname}/api/v2/connection`);
    url.searchParams.set('include_secrets', 'true');
    url.searchParams.set('connector_names', 'stripe');
    url.searchParams.set('environment', process.env.REPLIT_DEPLOYMENT === '1' ? 'production' : 'development');
    const resp = await fetch(url.toString(), { headers: { 'Accept': 'application/json', 'X-Replit-Token': xReplitToken } });
    const data = await resp.json();
    const cs = data.items?.[0];
    if (!cs?.settings?.secret) return null;
    const Stripe = require('stripe');
    _stripeClientForInvoiceEmail = new Stripe(cs.settings.secret);
    return _stripeClientForInvoiceEmail;
  } catch (e) {
    console.warn('[sendInvoiceEmail] Stripe init failed:', e.message);
    return null;
  }
}

let _pluginAuthHelpersCache = null;
// lexiChat (and any other handler intercepted here BEFORE the generic
// getFunctionHandlers() fallthrough) must reuse the same session-auth /
// checkAIUsage gate as the rest of the AI handlers — never re-implement it,
// or the two copies silently drift (this is exactly how lexiChat ended up
// ungated in prod while the dev copy in vite-functions-plugin.js was fixed).
async function getPluginAuthHelpers() {
  if (_pluginAuthHelpersCache) return _pluginAuthHelpersCache;
  try {
    const pluginPath = path.resolve(__dirname, '../vite-functions-plugin.js');
    const mod = await import(pluginPath);
    _pluginAuthHelpersCache = {
      getUserFromRequest: mod.getUserFromRequest,
      checkAIUsage: mod.checkAIUsage,
      logUsageEvent: mod.logUsageEvent,
    };
  } catch (e) {
    console.error('[Functions] Could not load plugin auth helpers:', e.message);
    _pluginAuthHelpersCache = { getUserFromRequest: async () => null, checkAIUsage: async () => ({ allowed: true }), logUsageEvent: async () => {} };
  }
  return _pluginAuthHelpersCache;
}

async function checkAIUsageProd(companyId) {
  const { checkAIUsage } = await getPluginAuthHelpers();
  return checkAIUsage(companyId);
}

async function logUsageEventProd(companyId, feature, units = 1) {
  const { logUsageEvent } = await getPluginAuthHelpers();
  return logUsageEvent(companyId, feature, units);
}

// Shared timeout + bounded-retry wrapper for outbound AI API calls (Gemini, OpenAI).
// Mirrors the fetchWithRetry helper in vite-functions-plugin.js / vite-integrations-plugin.js
// (kept as a local copy here since prod-integrations.cjs is CommonJS with no cross-import).
// Retries transient failures only: request timeout/abort, and 429/5xx responses.
async function fetchWithRetry(url, fetchOpts = {}, { retries = 2, timeoutMs = 60000, retryDelayMs = 800 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...fetchOpts, signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await new Promise(r => setTimeout(r, retryDelayMs * (attempt + 1)));
        continue;
      }
      return res;
    } catch (e) {
      if (e.noRetry) throw e;
      lastErr = e;
      const transient = e.name === 'AbortError' || e.name === 'TimeoutError' || /timeout|fetch failed|ECONNRESET|ETIMEDOUT/i.test(e.message || '');
      if (attempt < retries && transient) {
        await new Promise(r => setTimeout(r, retryDelayMs * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('Request failed after retries');
}

let _functionHandlersCache = null;
async function getFunctionHandlers() {
  if (_functionHandlersCache) return _functionHandlersCache;
  try {
    const pluginPath = path.resolve(__dirname, '../vite-functions-plugin.js');
    const mod = await import(pluginPath);
    _functionHandlersCache = mod.functionHandlers || {};
    console.log(`[Functions] Loaded ${Object.keys(_functionHandlersCache).length} handlers from plugin`);
  } catch (e) {
    console.error('[Functions] Could not load plugin handlers:', e.message);
    _functionHandlersCache = {};
  }
  return _functionHandlersCache;
}

const TRIAL_DAILY_AI_LIMIT = 20;

const UPLOADS_DIR = path.join(path.resolve(__dirname, '..'), 'uploads');
const PUBLIC_ROOT = path.join(process.cwd(), 'public');
const {
  registerLocalUploadCache,
  writeLocalUploadCache,
} = require('../lib/local-upload-cache.cjs');
if (!fs.existsSync(UPLOADS_DIR)) {
  try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {}
}
const localUploadCache = registerLocalUploadCache({
  uploadsDir: UPLOADS_DIR,
  publicRoot: PUBLIC_ROOT,
});

const MIME_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.csv': 'text/csv', '.txt': 'text/plain', '.heic': 'image/heic', '.heif': 'image/heif', '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.tif': 'image/tiff', '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function parseMultipartFormData(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[1].replace(/^["']|["']$/g, '');
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(boundaryBuffer);
  while (start !== -1) {
    start += boundaryBuffer.length;
    if (buffer[start] === 0x2D && buffer[start + 1] === 0x2D) break;
    start += 2;
    const headerEnd = buffer.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headers = buffer.slice(start, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(boundaryBuffer, dataStart);
    const dataEnd = nextBoundary !== -1 ? nextBoundary - 2 : buffer.length;
    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    const ctMatch = headers.match(/Content-Type:\s*(.+)/i);
    parts.push({
      name: nameMatch ? nameMatch[1] : 'unknown',
      filename: filenameMatch ? filenameMatch[1] : null,
      contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
      data: buffer.slice(dataStart, dataEnd),
    });
    start = nextBoundary;
  }
  return parts;
}

async function fetchFileAsBase64(url) {
  // Extract filename from URL — works for both /uploads/name.pdf and /name.pdf paths
  const uploadsMatch = url.match(/\/uploads\/([^?#]+)/);
  const rootMatch = url.match(/\/([a-f0-9-]{36}\.[a-z]+)(?:[?#]|$)/i);
  const fileNameRaw = uploadsMatch ? uploadsMatch[1] : (rootMatch ? rootMatch[1] : null);
  if (fileNameRaw) {
    const fileName = decodeURIComponent(fileNameRaw);
    const ext = path.extname(fileName).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    // 1. Object storage first (primary store post-migration)
    try {
      const buf = await objStorage.downloadFromObjectStorage(fileName);
      if (buf) return { base64: buf.toString('base64'), mimeType };
    } catch (e) {
      console.warn('[fetchFileAsBase64] Object storage read error:', e.message);
    }

    // 2. DB fallback (pre-migration files still have file_data)
    try {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const result = await pool.query('SELECT file_data, mime_type FROM file_uploads WHERE id = $1 AND file_data IS NOT NULL', [fileName]);
      if (result.rows.length > 0) {
        const { file_data, mime_type } = result.rows[0];
        return { base64: file_data.toString('base64'), mimeType: mime_type || mimeType };
      }
    } catch (e) {}

    // 3. Disk fallback — check all candidate locations
    const diskCandidates = [
      path.join(UPLOADS_DIR, fileName),
      path.join(process.cwd(), 'public', 'uploads', fileName),
      path.join(process.cwd(), 'public', fileName),
      path.join(process.cwd(), 'dist', fileName),
      path.join(process.cwd(), fileName),
    ];
    for (const localPath of diskCandidates) {
      if (fs.existsSync(localPath)) {
        const buffer = fs.readFileSync(localPath);
        return { base64: buffer.toString('base64'), mimeType };
      }
    }
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch file: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  return { base64: Buffer.from(buffer).toString('base64'), mimeType: resp.headers.get('content-type') || 'application/octet-stream' };
}

async function callGeminiWithSchema(apiKey, prompt, options = {}) {
  const { fileUrls = [], responseJsonSchema, model = 'gemini-2.5-flash' } = options;
  const parts = [];
  for (const url of fileUrls) {
    try {
      const { base64, mimeType } = await fetchFileAsBase64(url);
      parts.push({ inlineData: { mimeType, data: base64 } });
    } catch (err) {
      console.error(`[Integrations] Failed to fetch file ${url}: ${err.message}`);
    }
  }
  parts.push({ text: prompt });
  const generationConfig = { temperature: 0.2 };
  if (responseJsonSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = responseJsonSchema;
  }
  const body = { contents: [{ role: 'user', parts }], generationConfig };
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  // PDFs and multi-page reports regularly need longer than the short interactive
  // timeout. Retrying a timed-out document three times only turns one click into
  // several minutes of duplicate model work and still fails. Give document reads
  // one realistic deadline; retain bounded provider retries for text-only prompts.
  const isDocumentAnalysis = fileUrls.length > 0;
  const response = await fetchWithRetry(
    apiUrl,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    { timeoutMs: isDocumentAnalysis ? 150000 : 60000, retries: isDocumentAnalysis ? 0 : 2 }
  );
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'Gemini API error');
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('No valid response from Gemini');
  if (responseJsonSchema) {
    try { return JSON.parse(rawText); } catch {
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) try { return JSON.parse(jsonMatch[1]); } catch {}
      const braceMatch = rawText.match(/[\[{][\s\S]*[\]}]/);
      if (braceMatch) try { return JSON.parse(braceMatch[0]); } catch {}
      return rawText;
    }
  }
  return rawText;
}

async function handleUpload(req, res) {
  try {
    const rawBody = await readBody(req);
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) { sendJson(res, { error: 'Expected multipart/form-data' }, 400); return; }
    const parts = parseMultipartFormData(rawBody, contentType);
    const filePart = parts?.find(p => p.filename);
    if (!filePart) { sendJson(res, { error: 'No file found' }, 400); return; }
    if (filePart.data.length > 50 * 1024 * 1024) { sendJson(res, { error: 'File too large (50MB max)' }, 400); return; }
    const ALLOWED = new Set(['.jpg','.jpeg','.png','.gif','.webp','.svg','.pdf','.doc','.docx','.xls','.xlsx','.csv','.txt','.heic','.heif','.bmp','.tiff','.tif','.webm','.m4a','.mp3','.ogg','.wav']);
    const ext = path.extname(filePart.filename).toLowerCase();
    if (!ALLOWED.has(ext)) { sendJson(res, { error: `File type "${ext}" not allowed` }, 400); return; }
    const uniqueName = `${randomUUID()}${ext}`;
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    // 1. Upload to object storage (primary, scalable store)
    let storedInObjectStorage = false;
    try {
      await objStorage.uploadToObjectStorage(uniqueName, filePart.data, mimeType);
      storedInObjectStorage = true;
      console.log(`[Integrations] Uploaded ${uniqueName} to object storage (${filePart.data.length} bytes)`);
    } catch (osErr) {
      console.warn('[Integrations] Object storage upload failed, falling back to disk+DB:', osErr.message);
    }

    // 2. Save to disk as local cache (fast serving, fallback if object storage unavailable)
    const publicRoot = path.join(process.cwd(), 'public');
    const savePaths = [path.join(UPLOADS_DIR, uniqueName), path.join(publicRoot, uniqueName)];
    for (const savePath of savePaths) {
      writeLocalUploadCache(localUploadCache, savePath, filePart.data);
    }

    // 3. Save metadata row to DB (no binary if object storage succeeded)
    try {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      if (storedInObjectStorage) {
        // Metadata only — no binary stored in DB
        await pool.query(
          `INSERT INTO file_uploads (id, original_filename, mime_type, file_size) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
          [uniqueName, filePart.filename, mimeType, filePart.data.length]
        );
      } else {
        // Fallback: store binary in DB so file is not lost
        await pool.query(
          `INSERT INTO file_uploads (id, original_filename, mime_type, file_size, file_data) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
          [uniqueName, filePart.filename, mimeType, filePart.data.length, filePart.data]
        );
        console.warn('[Integrations] Stored binary in DB as object storage fallback');
      }
    } catch (dbErr) {
      console.warn('[Integrations] DB metadata save failed:', dbErr.message);
    }

    // Always use getcompanysync.com as the host for stored URLs
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const xHost = req.headers['x-forwarded-host'] || req.headers['host'] || '';
    const host = (xHost && xHost.includes('getcompanysync.com')) ? 'getcompanysync.com' : (xHost || 'getcompanysync.com');
    sendJson(res, { file_url: `${protocol}://${host}/uploads/${uniqueName}`, file_name: filePart.filename, size: filePart.data.length });
  } catch (err) {
    console.error('[Integrations] Upload error:', err.message);
    sendJson(res, { error: 'File upload failed. Please try again.' }, 500);
  }
}

async function handleInvokeLLM(req, res) {
  try {
    const body = await readJsonBody(req);
    const { prompt, file_urls, response_json_schema, model, companyId } = body;
    const prodDb = require('./prod-db.cjs');
    const cid = companyId || req.headers?.['x-company-id'];

    let apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    let usingPlatformKey = true;
    // plan is resolved below and used both for gating and usage logging
    let plan = 'trial';

    if (cid && cid !== 'companysync_master_001') {
      try {
        const companyKey = await prodDb.getCompanyGeminiKey(cid);
        const platformKey = process.env.GOOGLE_GEMINI_API_KEY;
        if (companyKey && companyKey !== platformKey) {
          apiKey = companyKey;
          usingPlatformKey = false;
        } else if (companyKey) {
          apiKey = companyKey;
        }
      } catch (e) {}

      if (usingPlatformKey) {
        try {
          plan = (await prodDb.getCompanyPlan(cid)) || 'trial';
          if (plan === 'trial') {
            // Trial: daily interaction cap
            const used = await prodDb.getDailyAIUsage(cid);
            if (cid !== 'companysync_master_001' && used >= TRIAL_DAILY_AI_LIMIT) {
              sendJson(res, {
                error: `You've used all ${TRIAL_DAILY_AI_LIMIT} free AI calls for today. Connect your own Google Gemini API key to remove this limit, or wait until midnight for the counter to reset.`,
                cap_reached: true,
                configure_url: '/APIKeysSettings',
                limit: TRIAL_DAILY_AI_LIMIT,
                used,
              }, 429);
              return;
            }
          } else {
            // Paid plan on platform key: enforce monthly interaction cap via shared gate.
            // BYOK companies get { allowed: true, byok: true } and are never blocked.
            // DB errors fall back to cached result (same logic as feature handlers).
            const { checkAIUsage: sharedCheck } = await getPluginAuthHelpers();
            const usageCheck = await sharedCheck(cid);
            if (!usageCheck.allowed) {
              sendJson(res, {
                error: usageCheck.error,
                cap_reached: true,
                configure_url: '/APIKeysSettings',
              }, 429);
              return;
            }
          }
        } catch (e) {
          console.warn('[DailyAI] Limit check failed (non-fatal):', e.message);
        }
      }
    }

    if (!apiKey) { sendJson(res, { error: 'GOOGLE_GEMINI_API_KEY not configured' }, 500); return; }
    if (!prompt) { sendJson(res, { error: 'prompt is required' }, 400); return; }

    const result = await callGeminiWithSchema(apiKey, prompt, { fileUrls: file_urls || [], responseJsonSchema: response_json_schema, model: model || 'gemini-2.5-flash' });

    // Track usage after a successful call so monthly caps reflect real consumption.
    if (cid && cid !== 'companysync_master_001' && usingPlatformKey) {
      if (plan === 'trial') {
        prodDb.incrementDailyAIUsage(cid).catch(() => {});
      } else {
        // Paid plan: write a SubscriptionUsage event so checkAIUsage monthly sums are accurate.
        getPluginAuthHelpers().then(({ logUsageEvent }) => logUsageEvent(cid, 'ai', 1)).catch(() => {});
      }
    }

    sendJson(res, { response: result });
  } catch (err) {
    console.error('[Integrations] InvokeLLM error:', err.message);
    const timedOut = /aborted due to timeout|timeout/i.test(err.message || '');
    sendJson(res, {
      error: timedOut
        ? 'Document analysis timed out. Please try a smaller PDF or try again shortly.'
        : 'AI request failed. Please try again.',
      retryable: !timedOut,
    }, timedOut ? 504 : 500);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Production platform sender. Keep this wrapper name for existing call sites,
// while sendEmailWithData preserves company SMTP as an override and delegates
// platform provider selection to the shared Postmark → SES → Resend transport.
// ─────────────────────────────────────────────────────────────────────
const PROD_FROM = () => process.env.EMAIL_FROM || 'CompanySync <noreply@companysync.io>';

async function sendViaResendProd({ to, from, subject, html, text, cc, replyTo, attachments, context, correlationId } = {}, retries = 3) {
  return require('../lib/emailTransport.cjs').sendPlatformEmail({
    to,
    from: from || PROD_FROM(),
    subject,
    html,
    text,
    cc,
    replyTo,
    attachments,
    context,
    // Dropping this here would silently disable the one identifier that can
    // still match a callback when the post-send writes fail.
    correlationId,
  }, retries);
}

async function authorizeCompanyEmailSenderProd(req, requestedCompanyId) {
  const { getUserFromRequest } = await getPluginAuthHelpers();
  const caller = await getUserFromRequest(req);
  if (!caller?.email) throw new Error('Authentication required');
  if (!requestedCompanyId) throw new Error('No company is selected');
  if (caller.is_super_admin) return caller;
  const pool = require('./prod-db.cjs').getPool();
  const membership = await pool.query(
    `SELECT 1 FROM companies c WHERE c.id = $2 AND (
       LOWER(COALESCE(c.created_by, '')) = LOWER($1)
       OR EXISTS (
         SELECT 1 FROM staff_profiles sp
         WHERE sp.company_id = c.id
           AND LOWER(COALESCE(NULLIF(sp.user_email, ''), sp.email)) = LOWER($1)
           AND COALESCE(sp.is_active, true) = true
       )
     ) LIMIT 1`,
    [caller.email, requestedCompanyId],
  );
  if (!membership.rowCount) throw new Error('You do not have access to send email for this company');
  return caller;
}

// Document-email authorization. The stored row's owner is authoritative: a
// client-supplied companyId must never let a caller mail another tenant's
// estimate or invoice, and a caller-built {to, subject, html} payload must be
// authorized exactly like a rendered one.
// See the matching note in vite-functions-plugin.js: camelCase and snake_case
// callers both exist, and only resolving one silently skips owner resolution.
function documentIdFromProd(params, idField) {
  const snake = idField.replace(/([A-Z])/g, (m) => '_' + m.toLowerCase());
  return params?.[idField] || params?.[snake] || null;
}

async function authorizeDocumentEmailProd(req, params, table, idField) {
  let companyId = params?.companyId || params?.company_id || req?.headers?.['x-company-id'] || null;
  // MUST use the same resolver the send path uses. Authorizing on the camelCase
  // id while the sender reads the snake_case one lets a caller authorize against
  // their own company and then send another tenant's document.
  const docId = documentIdFromProd(params, idField);
  if (docId) {
    // Fail CLOSED — see the matching comment in vite-functions-plugin.js.
    // Falling back to the caller-supplied company id on a lookup error lets a
    // caller send under another tenant by making the ownership query fail.
    let owner;
    try {
      const pool = require('./prod-db.cjs').getPool();
      owner = await pool.query(`SELECT company_id FROM ${table} WHERE id = $1 LIMIT 1`, [docId]);
    } catch (e) {
      console.error(`[Email] Could not resolve ${table} owner for authorization:`, e.message);
      throw new Error('Could not verify who owns this document, so the email was not sent');
    }
    const ownerCompanyId = owner.rows[0]?.company_id;
    if (!ownerCompanyId) throw new Error('That document does not exist, so the email was not sent');
    companyId = ownerCompanyId;
  }
  const caller = await authorizeCompanyEmailSenderProd(req, companyId);
  return { caller, companyId };
}

async function sendEmailWithData(emailData, companyIdHint) {
  const { to, subject, body: emailBody, from, html, cc, replyTo, companyId, correlationId } = emailData;
  if (!to || !subject) throw new Error('to and subject are required');

  const prodDb = require('./prod-db.cjs');
  const cid = companyId || companyIdHint;

  const context = emailData.context || { companyId: cid, source: 'production_workflow' };

  // 1. Company-specific SMTP override (only if the company configured their own).
  // Reading the config and SENDING are separated on purpose: a config-read miss
  // may fall through to the platform provider, but a send failure must not —
  // that used to risk delivering the same message twice.
  let smtpConfig = null;
  try {
    if (cid) {
      const emailConfig = await prodDb.getCompanyEmailConfig(cid);
      if (emailConfig?.type === 'smtp') smtpConfig = emailConfig;
    }
  } catch (e) {
    console.warn('[Email] Could not read company SMTP config:', e.message);
  }

  if (smtpConfig) {
    // Company SMTP is still our outbound reputation surface, so it goes through
    // the same pause gate, rate limits and attribution as the platform provider.
    const emailHealth = require('../lib/emailProviderHealth.cjs');
    const emailSafety = require('../lib/emailSafety.cjs');
    const transportLib = require('../lib/emailTransport.cjs');
    // Same recipient rules as the platform provider — otherwise company SMTP is
    // a way to reach addresses (and recipient counts) the platform would reject.
    const toList = transportLib.normalizeRecipients(to, subject);
    const ccList = cc ? transportLib.normalizeRecipients(cc, subject) : [];
    const recipients = [...new Set([...toList, ...ccList].map((address) => address.toLowerCase()))];
    if (recipients.length > transportLib.MAX_RECIPIENTS_PER_SEND) {
      const error = new Error(`[Email] At most ${transportLib.MAX_RECIPIENTS_PER_SEND} recipients are allowed per send`);
      error.code = 'EMAIL_TOO_MANY_RECIPIENTS';
      error.noRetry = true;
      throw error;
    }
    // Same content caps as the platform provider — company SMTP must not be a
    // way to push unbounded subject/body past the shared limits.
    emailSafety.assertContentWithinLimits({ subject, html, text: emailBody });
    await emailHealth.ensureHydrated();
    emailHealth.assertDeliveryAllowed();

    const nodemailer = require('nodemailer');
    const defaultFrom = from || smtpConfig.from || PROD_FROM();
    const toStr = toList.join(', ');
    const transport = nodemailer.createTransport({
      host: smtpConfig.host, port: smtpConfig.port,
      secure: smtpConfig.secure, auth: smtpConfig.auth,
    });
    let verified = true;
    try {
      await transport.verify();
    } catch (verifyErr) {
      // Nothing was transmitted, so falling back here cannot duplicate a message.
      verified = false;
      console.warn(`[Email] Company SMTP for ${cid} is not usable (${verifyErr.message}) — using the platform provider.`);
    }
    if (verified) {
      try {
        // A failed verify falls through to sendPlatformEmail(), which reserves
        // the shared capacity itself. Reserve here only when SMTP will send.
        await emailSafety.assertCanSend(context, recipients.length);
        const info = await transport.sendMail({
          from: defaultFrom, to: toStr, subject,
          ...(ccList.length ? { cc: ccList.join(', ') } : {}),
          ...(html ? { html } : { text: emailBody || '' }),
          // Company SMTP is a delivery path like any other: without the
          // correlation header its callbacks cannot be matched either.
          ...(correlationId ? { headers: { [transportLib.CORRELATION_HEADER]: correlationId } } : {}),
        });
        const result = { success: true, id: info.messageId, provider: 'company_smtp' };
        emailSafety.recordDeliveryAttempt({ context, recipients, subject, result }).catch(() => {});
        console.log('[Email] Sent via company SMTP:', info.messageId, '→', toStr);
        return result;
      } catch (sendErr) {
        emailSafety.recordDeliveryAttempt({ context, recipients, subject, error: sendErr }).catch(() => {});
        console.error('[Email] Company SMTP send failed:', sendErr.message);
        throw sendErr;
      }
    }
  }

  // 2. Shared platform provider (Postmark → SES → Resend)
  return sendViaResendProd({
    to, from, subject, html, text: emailBody, cc, replyTo, context, correlationId,
  });
}

async function sendEstimateEmailProd(params, companyIdHint, req) {
  // If caller already built subject + html + to, use directly
  if (params.html && params.subject && params.to) {
    return sendEmailWithData(params, companyIdHint);
  }

  const prodDb = require('./prod-db.cjs');
  const pool = prodDb.getPool();

  // Resolve the caller's company server-side from the authenticated session email.
  // Session format: passport.user.claims.email (set by prod-auth.cjs).
  // We look up staff_profiles to derive company_id from identity — never
  // trusting client-supplied body fields or x-company-id header for this.
  let sessionCompanyId = null;
  if (req) {
    try {
      const prodAuth = require('./prod-auth.cjs');
      const session = await prodAuth.getSessionFromRequest(req, pool);
      const sessionEmail = session?.data?.passport?.user?.claims?.email
        || session?.data?.user?.email
        || session?.data?.email
        || null;
      if (sessionEmail) {
        const staffRes = await pool.query(
          `SELECT company_id FROM staff_profiles
           WHERE LOWER(COALESCE(NULLIF(user_email,''), email)) = LOWER($1)
             AND is_active = true LIMIT 1`,
          [sessionEmail]
        );
        sessionCompanyId = staffRes.rows[0]?.company_id || null;
      }
    } catch (e) {
      console.warn('[sendEstimateEmailProd] Could not resolve session company:', e.message);
    }
  }

  let estimate = null;
  // Prefer the session-resolved company; fall back to the DB-resolved value or hint.
  let companyId = params.companyId || companyIdHint;

  const estimateIdParam = documentIdFromProd(params, 'estimateId');
  if (estimateIdParam) {
    const res = await pool.query(
      `SELECT id, company_id, customer_name, customer_email, estimate_number,
              total_amount, property_address, insurance_company, claim_number, notes, data
       FROM estimates WHERE id = $1 LIMIT 1`,
      [estimateIdParam]
    );
    if (!res.rows.length) throw new Error('Estimate not found');
    const row = res.rows[0];
    const jsonb = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
    estimate = { ...jsonb, ...row };
    companyId = companyId || row.company_id;
  } else if (params.estimateData) {
    estimate = { ...params.estimateData };
    if (params.customerName) estimate.customer_name = estimate.customer_name || params.customerName;
  }

  if (!estimate) throw new Error('No estimate data provided');

  const toEmail = params.to || estimate.customer_email;
  if (!toEmail) throw new Error('No customer email on this estimate. Add the customer email and try again.');

  let coName = '', coPhone = '', coEmailAddr = '', coAddress = '', coWebsite = '', coLogo = '';
  if (companyId) {
    try {
      const coRes = await pool.query(
        `SELECT name, phone, email, address, website, logo_url FROM companies WHERE id = $1 LIMIT 1`,
        [companyId]
      );
      if (coRes.rows.length > 0) {
        const co = coRes.rows[0];
        coName = co.name || ''; coPhone = co.phone || '';
        coEmailAddr = co.email || ''; coAddress = co.address || '';
        coWebsite = co.website || ''; coLogo = co.logo_url || '';
      }
    } catch (e) { console.warn('[sendEstimateEmail] Could not load company:', e.message); }
  }

  const estimateNum  = estimate.estimate_number || '';
  const customerName = estimate.customer_name || 'Customer';
  const totalRcv     = parseFloat(estimate.total_rcv || estimate.total_amount || estimate.amount || 0);
  const address      = estimate.property_address || '';
  const claimNum     = estimate.claim_number || '';
  const insComp      = estimate.insurance_company || '';
  const notes        = estimate.notes || '';
  const baseUrl      = process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com';
  const { appendToken } = require('../lib/estimateToken.cjs');
  const estimateUrl  = estimate.id ? appendToken(`${baseUrl}/ViewEstimate?id=${estimate.id}`, estimate.id) : '';
  const pdfUrl       = estimate.id ? appendToken(`${baseUrl}/api/public-estimate-pdf?id=${estimate.id}`, estimate.id) : '';

  const logoBlock = coLogo
    ? `<img src="${coLogo}" alt="${coName}" style="max-height:60px;max-width:180px;object-fit:contain;display:block;margin:0 auto;" />`
    : `<span style="font-size:22px;font-weight:800;color:#ffffff;">${coName || 'Your Contractor'}</span>`;

  const contactItems = [];
  if (coPhone) contactItems.push(`<a href="tel:${coPhone.replace(/\D/g,'')}" style="color:#1d4ed8;text-decoration:none;font-weight:600;">${coPhone}</a>`);
  if (coEmailAddr) contactItems.push(`<a href="mailto:${coEmailAddr}" style="color:#1d4ed8;text-decoration:none;font-weight:600;">${coEmailAddr}</a>`);
  if (coWebsite) contactItems.push(`<a href="${coWebsite.startsWith('http')?coWebsite:'https://'+coWebsite}" target="_blank" style="color:#1d4ed8;text-decoration:none;font-weight:600;">${coWebsite}</a>`);
  const contactRow = contactItems.length ? `<p style="margin:0 0 8px 0;">${contactItems.join('&nbsp;&nbsp;|&nbsp;&nbsp;')}</p>` : '';

  const detailRows = [
    estimateNum ? `<tr><td style="padding:8px 12px;font-weight:600;color:#374151;width:40%;">Estimate #</td><td style="padding:8px 12px;color:#1e3a8a;font-weight:700;">${estimateNum}</td></tr>` : '',
    address     ? `<tr><td style="padding:8px 12px;font-weight:600;color:#374151;">Property</td><td style="padding:8px 12px;color:#374151;">${address}</td></tr>` : '',
    insComp     ? `<tr><td style="padding:8px 12px;font-weight:600;color:#374151;">Insurance</td><td style="padding:8px 12px;color:#374151;">${insComp}</td></tr>` : '',
    claimNum    ? `<tr><td style="padding:8px 12px;font-weight:600;color:#374151;">Claim #</td><td style="padding:8px 12px;color:#374151;">${claimNum}</td></tr>` : '',
  ].filter(Boolean).join('');

  const actionButtons = estimateUrl ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0 0;">
      <tr>
        <td align="center" style="padding-bottom:12px;">
          <a href="${estimateUrl}" target="_blank"
             style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;
                    font-size:15px;font-weight:700;padding:14px 32px;border-radius:8px;
                    letter-spacing:0.2px;box-shadow:0 2px 10px rgba(29,78,216,0.3);">
            View Your Estimate Online
          </a>
        </td>
      </tr>
      ${pdfUrl ? `<tr>
        <td align="center">
          <a href="${pdfUrl}" target="_blank"
             style="display:inline-block;background:#ffffff;color:#1d4ed8;text-decoration:none;
                    font-size:14px;font-weight:600;padding:12px 32px;border-radius:8px;
                    border:2px solid #1d4ed8;">
            Download PDF
          </a>
        </td>
      </tr>` : ''}
    </table>` : '';

  const subject = `Your Estimate${estimateNum ? ' #' + estimateNum : ''} from ${coName || 'Your Contractor'}`;
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f0f4ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);border-radius:14px 14px 0 0;padding:32px;text-align:center;">${logoBlock}</td></tr>
        <tr><td style="background:#fff;padding:40px 44px 32px;">
          <h2 style="margin:0 0 8px;font-size:22px;color:#1e3a8a;">Hi ${customerName},</h2>
          <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.7;">
            Thank you for the opportunity to work with you. Please find your estimate details below.
            ${params.pdfBase64 ? 'A copy of the estimate is also attached as a PDF for your records.' : ''}
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e7ff;border-radius:10px;overflow:hidden;margin-bottom:24px;">
            ${detailRows}
            <tr style="background:#eff6ff;"><td style="padding:12px 12px;font-weight:700;color:#1e3a8a;font-size:16px;">Total Estimate</td><td style="padding:12px 12px;font-weight:800;color:#1e3a8a;font-size:20px;">$${totalRcv.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>
          </table>
          ${notes ? `<p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;background:#f9fafb;border-left:3px solid #93c5fd;padding:12px 16px;border-radius:0 8px 8px 0;"><strong>Notes:</strong> ${notes}</p>` : ''}
          <p style="margin:0 0 4px;font-size:15px;color:#374151;line-height:1.7;">
            If you have any questions or are ready to move forward, please don't hesitate to reach out — we're happy to help!
          </p>
          ${actionButtons}
        </td></tr>
        <tr><td style="background:#f8faff;border-top:1px solid #e0e7ff;border-bottom:1px solid #e0e7ff;padding:20px 44px;text-align:center;">
          ${coName ? `<p style="margin:0 0 10px;font-size:15px;font-weight:800;color:#1e3a8a;">${coName}</p>` : ''}
          ${contactRow}
          ${coAddress ? `<p style="margin:6px 0 0;font-size:12px;color:#6b7280;">${coAddress}</p>` : ''}
        </td></tr>
        <tr><td style="background:#f0f4ff;border-radius:0 0 14px 14px;padding:16px 44px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#94a3b8;">You received this message from ${coName || 'your contractor'} via CompanySync.</p>
        </td></tr>
        <tr><td style="height:24px;"></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const attachments = [];
  if (params.pdfBase64) {
    attachments.push({
      filename: `Estimate${estimateNum ? '-' + estimateNum : ''}.pdf`,
      content: params.pdfBase64,
    });
  }

  // ── Claims Defense File PDF (adjuster emails only) ───────────────────────
  // Security: the PDF is only generated when the caller has an authenticated
  // server-side session. sessionCompanyId is resolved exclusively from the
  // session (never from a client-supplied header or body field), so there is
  // no fallback that allows cross-tenant job ID injection.
  const isAdjusterEmail = params.emailType === 'adjuster' || params.emailType === 'insurance_adjuster';
  let claimsAttachWarning = null;
  if (isAdjusterEmail && params.attach_claims_defense && params.inspection_job_id) {
    if (!sessionCompanyId) {
      claimsAttachWarning = 'Claims Defense PDF not attached: authentication required.';
      console.warn('[sendEstimateEmailProd] Claims Defense PDF skipped — no authenticated session company');
    } else {
      try {
        // Ownership gate: confirm the job belongs to the session-resolved company only.
        const jobOwnerRes = await pool.query(
          `SELECT id FROM generic_entities
           WHERE id = $1 AND entity_type = 'InspectionJob'
             AND (company_id = $2 OR data->>'company_id' = $2)
           LIMIT 1`,
          [params.inspection_job_id, sessionCompanyId]
        );
        if (jobOwnerRes.rows.length === 0) {
          console.warn(`[sendEstimateEmailProd] Claims Defense PDF skipped — job ${params.inspection_job_id} not owned by session company ${sessionCompanyId}`);
          claimsAttachWarning = 'Claims Defense PDF not attached: the linked inspection job does not belong to this company.';
        } else {
          const handlers = await getFunctionHandlers();
          if (typeof handlers.generateProofPackagePDF === 'function') {
            const pdfResult = await handlers.generateProofPackagePDF(
              { inspection_job_id: params.inspection_job_id, company_id: sessionCompanyId, include_branding: true },
              null, null
            );
            const claimsBase64 = pdfResult?.base64;
            if (claimsBase64) {
              const estimatedBytes = Math.ceil(claimsBase64.length * 0.75);
              const MAX_ATTACH_BYTES = 8 * 1024 * 1024; // 8 MB
              if (estimatedBytes <= MAX_ATTACH_BYTES) {
                attachments.push({
                  filename: `ClaimsDefenseFile${estimateNum ? '-' + estimateNum : ''}.pdf`,
                  content: claimsBase64,
                });
                console.log(`[sendEstimateEmailProd] Claims Defense PDF attached (~${Math.round(estimatedBytes / 1024)}KB)`);
              } else {
                claimsAttachWarning = `Claims Defense PDF was too large to attach (${Math.round(estimatedBytes / 1024)} KB; limit 8 MB). Share the portal link instead.`;
                console.warn(`[sendEstimateEmailProd] Claims Defense PDF too large, skipping attachment`);
              }
            }
          } else {
            console.warn('[sendEstimateEmailProd] generateProofPackagePDF handler not available');
          }
        }
      } catch (pdfErr) {
        console.warn('[sendEstimateEmailProd] Failed to generate Claims Defense PDF:', pdfErr.message);
        claimsAttachWarning = 'Claims Defense PDF could not be generated: ' + pdfErr.message;
      }
    }
  }

  const smtpEmail = PROD_FROM().match(/<(.+)>/)?.[1] || PROD_FROM();
  const fromAddr  = coName ? `${coName} <${smtpEmail}>` : PROD_FROM();
  const replyTo   = coEmailAddr || undefined;
  console.log(`[sendEstimateEmail] Sending to ${toEmail} — estimate ${estimateNum}`);
  // The caller already resolved the owning company and actor; forward that
  // context or this send lands in the default platform bucket unattributed.
  const sendResult = await sendViaResendProd({ from: fromAddr, to: toEmail, subject, html, replyTo, context: params?.context, ...(attachments.length ? { attachments } : {}) });
  if (claimsAttachWarning) {
    return { ...sendResult, claims_attach_warning: claimsAttachWarning };
  }
  return sendResult;
}

async function sendInvoiceEmailProd(params, companyIdHint) {
  if (params.html && params.subject && params.to) {
    return sendEmailWithData(params, companyIdHint);
  }

  const prodDb = require('./prod-db.cjs');
  const pool = prodDb.getPool();

  let invoice = null;
  let companyId = params.companyId || companyIdHint;

  const invoiceIdParam = documentIdFromProd(params, 'invoiceId');
  if (invoiceIdParam) {
    const res = await pool.query(
      `SELECT id, company_id, customer_name, customer_email,
              invoice_number, status, total_amount, amount_paid, due_date,
              notes, items, created_at, data
       FROM invoices WHERE id = $1 LIMIT 1`,
      [invoiceIdParam]
    );
    if (!res.rows.length) throw new Error('Invoice not found');
    const row = res.rows[0];
    const jsonb = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
    invoice = { ...jsonb, ...row };
    companyId = companyId || row.company_id;
  } else if (params.invoiceData) {
    invoice = { ...params.invoiceData };
  }

  if (!invoice) throw new Error('No invoice data provided');

  const toEmail = params.to || invoice.customer_email;
  if (!toEmail) {
    throw new Error('No customer email on this invoice. Add a customer email and try again.');
  }

  let coName = '', coPhone = '', coEmailAddr = '', coAddress = '', coWebsite = '', coLogo = '', coStripeAccount = '';
  if (companyId) {
    try {
      const coRes = await pool.query(
        `SELECT name, phone, email, address, website, logo_url, stripe_account_id FROM companies WHERE id = $1 LIMIT 1`,
        [companyId]
      );
      if (coRes.rows.length > 0) {
        const co = coRes.rows[0];
        coName = co.name || ''; coPhone = co.phone || '';
        coEmailAddr = co.email || ''; coAddress = co.address || '';
        coWebsite = co.website || ''; coLogo = co.logo_url || '';
        coStripeAccount = co.stripe_account_id || '';
      }
    } catch (e) { console.warn('[sendInvoiceEmail] Could not load company:', e.message); }
  }

  const invoiceNum   = invoice.invoice_number || '';
  const customerName = invoice.customer_name || 'Customer';
  const total        = parseFloat(invoice.total_amount || invoice.amount || 0);
  const paid         = parseFloat(invoice.amount_paid || 0);
  const balance      = Math.max(0, total - paid);
  // custom_amount lets callers request a partial payment (e.g. deposit / draw)
  const chargeAmount = (params.custom_amount > 0 && params.custom_amount <= balance)
    ? params.custom_amount : balance;
  const address      = invoice.property_address || '';
  const notes        = invoice.notes || '';
  const baseUrl      = process.env.VITE_REPLIT_APP_URL || 'https://getcompanysync.com';

  // Generate a Stripe Checkout link so the customer can pay with one click.
  let invoiceUrl = '';
  if (chargeAmount > 0) {
    try {
      const stripeClient = await _getStripeClientForInvoiceEmail();
      if (stripeClient) {
        const sessionConfig = {
          payment_method_types: ['card', 'us_bank_account'],
          payment_method_options: {
            us_bank_account: {
              financial_connections: { permissions: ['payment_method'] },
            },
          },
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Invoice${invoiceNum ? ' #' + invoiceNum : ''}`,
                description: coName ? `Payment to ${coName}` : 'Invoice payment',
              },
              unit_amount: Math.round(chargeAmount * 100),
            },
            quantity: 1,
          }],
          // NOTE: intentionally NOT passing customer_email. When we prefill it,
          // Stripe Link recognizes returning customers and auto-loads their saved
          // CARD, which hides the bank-transfer (ACH) option. Omitting it shows the
          // standard form where Card and US bank account are both clear choices.
          // Confirmation emails are unaffected — the webhook falls back to the
          // invoice's stored customer_email.
          success_url: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&invoice_id=${invoice.id || ''}`,
          cancel_url: `${baseUrl}/payment-cancel?invoice_id=${invoice.id || ''}`,
          metadata: {
            invoice_id: String(invoice.id || ''),
            invoice_number: invoiceNum || '',
            company_id: String(companyId || ''),
          },
        };
        if (coStripeAccount) {
          sessionConfig.payment_intent_data = {
            // on_behalf_of makes Stripe show the connected company's name/logo on
            // the checkout page instead of "CompanySync". Must be nested inside
            // payment_intent_data — Stripe rejects it as a top-level Checkout
            // Session param ("Received unknown parameter: on_behalf_of").
            on_behalf_of: coStripeAccount,
            application_fee_amount: Math.round(chargeAmount * 0.005 * 100),
            transfer_data: { destination: coStripeAccount },
          };
        }
        const idemBucket = Math.floor(Date.now() / 30000);
        const idempotencyKey = 'ck_' + crypto.createHash('sha256')
          .update(['invoice-email-payment-link', invoice.id || '', chargeAmount, idemBucket].join(':'))
          .digest('hex').slice(0, 32);
        const session = await stripeClient.checkout.sessions.create(sessionConfig, { idempotencyKey });
        invoiceUrl = session.url;
        console.log(`[sendInvoiceEmail] Stripe Checkout session created for invoice ${invoiceNum}`);
      }
    } catch (e) {
      console.warn('[sendInvoiceEmail] Could not create Stripe payment link:', e.message);
    }
  }

  // Fetch payment settings from CompanySetting (generic_entities) and build "How to Pay" section
  let companySettings = null;
  if (companyId) {
    try {
      const csRes = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'CompanySetting' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
        [companyId]
      );
      if (csRes.rows.length > 0) {
        companySettings = typeof csRes.rows[0].data === 'string'
          ? JSON.parse(csRes.rows[0].data)
          : csRes.rows[0].data;
      }
    } catch (e) {
      console.warn('[sendInvoiceEmail] Could not load company settings:', e.message);
    }
  }

  let paymentOptionsHTML = '';
  const hasCashApp = companySettings?.cashapp_handle;
  const hasVenmo   = companySettings?.venmo_handle;
  const hasZelle   = companySettings?.zelle_email;
  const hasCheck   = companySettings?.check_payment_instructions;
  const hasCash    = companySettings?.cash_payment_instructions;

  if (hasCashApp || hasVenmo || hasZelle || hasCheck || hasCash) {
    const sections = [];

    if (hasCashApp) {
      const cashtag = companySettings.cashapp_handle.startsWith('$')
        ? companySettings.cashapp_handle
        : `$${companySettings.cashapp_handle}`;
      const cashAppUrl = `https://cash.app/${cashtag}`;
      sections.push(`
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px;">
          <tr><td style="padding:20px;">
            <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#00d632;">💵 Cash App</p>
            <div style="background:#f3f4f6;padding:12px;border-radius:6px;border-left:4px solid #00d632;margin:10px 0;">
              <p style="margin:0 0 4px;font-size:12px;color:#6b7280;">Send payment to:</p>
              <p style="margin:0;font-size:20px;font-weight:700;font-family:monospace;color:#111827;">${cashtag}</p>
              <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">Copy this handle and paste it in the "To:" field if it doesn't auto-fill</p>
            </div>
            <a href="${cashAppUrl}" style="display:inline-block;background:#00d632;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px;">Open Cash App →</a>
            <p style="margin:10px 0 0;font-size:12px;color:#9ca3af;">💡 Include invoice #${invoiceNum} in the note. Instant transfer, no fees between Cash App users.</p>
          </td></tr>
        </table>`);
    }

    if (hasZelle) {
      sections.push(`
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px;">
          <tr><td style="padding:20px;">
            <p style="margin:0 0 10px;font-size:18px;font-weight:700;color:#6b21a8;">💸 Zelle</p>
            <p style="margin:0 0 6px;font-size:14px;color:#374151;">Send to: <strong>${companySettings.zelle_email}</strong></p>
            <div style="background:#f3f4f6;padding:12px;border-radius:4px;border-left:3px solid #6b21a8;margin-bottom:8px;">
              <p style="margin:0;font-size:13px;color:#374151;">📝 Include invoice #${invoiceNum} in the memo</p>
            </div>
            <p style="margin:0;font-size:12px;color:#9ca3af;">💡 Free bank-to-bank transfer. Usually arrives in minutes, typically within 1 business day.</p>
          </td></tr>
        </table>`);
    }

    if (hasVenmo) {
      const venmoHandle = companySettings.venmo_handle.replace('@', '');
      const venmoUrl = `https://venmo.com/u/${venmoHandle}?txn=pay&amount=${balance.toFixed(2)}&note=Invoice%20${encodeURIComponent(invoiceNum)}`;
      sections.push(`
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px;">
          <tr><td style="padding:20px;">
            <p style="margin:0 0 10px;font-size:18px;font-weight:700;color:#008cff;">💙 Venmo</p>
            <p style="margin:0 0 12px;font-size:14px;color:#374151;">Send to: <strong>${companySettings.venmo_handle}</strong></p>
            <a href="${venmoUrl}" style="display:inline-block;background:#008cff;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:700;font-size:14px;">Open Venmo →</a>
            <p style="margin:10px 0 0;font-size:12px;color:#9ca3af;">💡 Include invoice #${invoiceNum} in the note.</p>
          </td></tr>
        </table>`);
    }

    if (hasCheck) {
      sections.push(`
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px;">
          <tr><td style="padding:20px;">
            <p style="margin:0 0 10px;font-size:18px;font-weight:700;color:#f59e0b;">✅ Check</p>
            <p style="margin:0 0 10px;font-size:14px;color:#374151;white-space:pre-line;">${companySettings.check_payment_instructions}</p>
            <div style="background:#f3f4f6;padding:12px;border-radius:4px;border-left:3px solid #f59e0b;margin-bottom:8px;">
              <p style="margin:0;font-size:13px;color:#374151;">📝 Write invoice #${invoiceNum} on the check memo line</p>
            </div>
            <p style="margin:0;font-size:12px;color:#9ca3af;">💡 Allow 5-7 business days for mail delivery and processing.</p>
          </td></tr>
        </table>`);
    }

    if (hasCash) {
      sections.push(`
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:12px;">
          <tr><td style="padding:20px;">
            <p style="margin:0 0 10px;font-size:18px;font-weight:700;color:#10b981;">💵 Cash</p>
            <p style="margin:0 0 8px;font-size:14px;color:#374151;white-space:pre-line;">${companySettings.cash_payment_instructions}</p>
            <p style="margin:0;font-size:12px;color:#9ca3af;">💡 Request a receipt for your records when paying in cash.</p>
          </td></tr>
        </table>`);
    }

    paymentOptionsHTML = `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
        <tr><td style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border-radius:10px;padding:24px;">
          <h2 style="color:#ffffff;margin:0 0 16px;text-align:center;font-size:22px;">💳 How to Pay</h2>
          ${sections.join('')}
        </td></tr>
      </table>`;
  }

  let dueDateStr = '';
  if (invoice.due_date) {
    try { dueDateStr = new Date(invoice.due_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); } catch (_) {}
  }

  const logoBlock = coLogo
    ? `<img src="${coLogo}" alt="${coName}" style="max-height:60px;max-width:180px;object-fit:contain;display:block;margin:0 auto;" />`
    : `<span style="font-size:22px;font-weight:800;color:#ffffff;">${coName || 'Your Contractor'}</span>`;

  const contactItems = [];
  if (coPhone) contactItems.push(`<a href="tel:${coPhone.replace(/\D/g,'')}" style="color:#1d4ed8;text-decoration:none;font-weight:600;">${coPhone}</a>`);
  if (coEmailAddr) contactItems.push(`<a href="mailto:${coEmailAddr}" style="color:#1d4ed8;text-decoration:none;font-weight:600;">${coEmailAddr}</a>`);
  if (coWebsite) contactItems.push(`<a href="${coWebsite.startsWith('http')?coWebsite:'https://'+coWebsite}" target="_blank" style="color:#1d4ed8;text-decoration:none;font-weight:600;">${coWebsite}</a>`);
  const contactRow = contactItems.length ? `<p style="margin:0 0 8px 0;">${contactItems.join('&nbsp;&nbsp;|&nbsp;&nbsp;')}</p>` : '';

  const detailRows = [
    invoiceNum ? `<tr><td style="padding:8px 12px;font-weight:600;color:#374151;width:40%;">Invoice #</td><td style="padding:8px 12px;color:#1e3a8a;font-weight:700;">${invoiceNum}</td></tr>` : '',
    address    ? `<tr><td style="padding:8px 12px;font-weight:600;color:#374151;">Property</td><td style="padding:8px 12px;color:#374151;">${address}</td></tr>` : '',
    dueDateStr ? `<tr><td style="padding:8px 12px;font-weight:600;color:#374151;">Due Date</td><td style="padding:8px 12px;color:#374151;">${dueDateStr}</td></tr>` : '',
  ].filter(Boolean).join('');

  const actionButton = invoiceUrl ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0 0;">
      <tr><td align="center">
        <a href="${invoiceUrl}" target="_blank"
           style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;
                  font-size:16px;font-weight:700;padding:16px 36px;border-radius:8px;
                  box-shadow:0 2px 10px rgba(29,78,216,0.3);">Pay $${chargeAmount.toFixed(2)} Now</a>
      </td></tr>
      <tr><td align="center" style="padding-top:10px;">
        <p style="margin:0;font-size:12px;color:#6b7280;">Secure payment powered by Stripe</p>
      </td></tr>
      <tr><td align="center" style="padding-top:6px;">
        <p style="margin:0;font-size:12px;color:#059669;">💡 <strong>Tip:</strong> Choose <em>"US bank account"</em> at checkout to pay directly from your checking account — lowest processing cost.</p>
      </td></tr>
    </table>` : '';
  const ctaText = invoiceUrl
    ? 'Click the button below to pay this invoice securely online.'
    : (coPhone || coEmailAddr)
      ? `To pay this invoice, please contact ${coName || 'us'} directly${coPhone ? ' at ' + coPhone : ''}${coEmailAddr ? (coPhone ? ' or ' : ' at ') + coEmailAddr : ''}.`
      : 'Please contact us to arrange payment for this invoice.';

  const isPartialRequest = params.custom_amount > 0 && Math.abs(params.custom_amount - balance) > 0.01;
  const subject = isPartialRequest
    ? `Payment Request — $${chargeAmount.toFixed(2)}${invoiceNum ? ' (Invoice #' + invoiceNum + ')' : ''}${coName ? ' | ' + coName : ''}`
    : `Invoice${invoiceNum ? ' #' + invoiceNum : ''} from ${coName || 'Your Contractor'} — $${balance.toFixed(2)} due`;
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#f0f4ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);border-radius:14px 14px 0 0;padding:32px;text-align:center;">${logoBlock}</td></tr>
        <tr><td style="background:#fff;padding:40px 44px 32px;">
          <h2 style="margin:0 0 8px;font-size:22px;color:#1e3a8a;">Hi ${customerName},</h2>
          <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.7;">Thank you for your business! Please find your invoice details below.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e7ff;border-radius:10px;overflow:hidden;margin-bottom:24px;">
            ${detailRows}
            ${paid > 0 ? `<tr><td style="padding:8px 12px;font-weight:600;color:#374151;">Total</td><td style="padding:8px 12px;color:#374151;">$${total.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>
            <tr><td style="padding:8px 12px;font-weight:600;color:#16a34a;">Paid</td><td style="padding:8px 12px;color:#16a34a;">$${paid.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>` : ''}
            <tr style="background:#eff6ff;"><td style="padding:12px 12px;font-weight:700;color:#1e3a8a;font-size:16px;">${isPartialRequest ? 'Amount Requested' : 'Balance Due'}</td><td style="padding:12px 12px;font-weight:800;color:#1e3a8a;font-size:20px;">$${chargeAmount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>
            ${isPartialRequest ? `<tr><td style="padding:4px 12px 10px;font-size:12px;color:#6b7280;" colspan="2">Full balance: $${balance.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>` : ''}
          </table>
          ${notes ? `<p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6;background:#f9fafb;border-left:3px solid #93c5fd;padding:12px 16px;border-radius:0 8px 8px 0;"><strong>Notes:</strong> ${notes}</p>` : ''}
          <p style="margin:0;font-size:15px;color:#374151;line-height:1.7;">${ctaText}</p>
          ${actionButton}
          ${paymentOptionsHTML}
        </td></tr>
        <tr><td style="background:#f8faff;border-top:1px solid #e0e7ff;border-bottom:1px solid #e0e7ff;padding:20px 44px;text-align:center;">
          ${coName ? `<p style="margin:0 0 10px;font-size:15px;font-weight:800;color:#1e3a8a;">${coName}</p>` : ''}
          ${contactRow}
          ${coAddress ? `<p style="margin:6px 0 0;font-size:12px;color:#6b7280;">${coAddress}</p>` : ''}
        </td></tr>
        <tr><td style="background:#f0f4ff;border-radius:0 0 14px 14px;padding:16px 44px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#94a3b8;">You received this message from ${coName || 'your contractor'} via CompanySync.</p>
        </td></tr>
        <tr><td style="height:24px;"></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const attachments = [];
  if (params.pdfBase64) {
    attachments.push({ filename: `Invoice${invoiceNum ? '-' + invoiceNum : ''}.pdf`, content: params.pdfBase64 });
  }

  const smtpEmail = PROD_FROM().match(/<(.+)>/)?.[1] || PROD_FROM();
  const fromAddr  = coName ? `${coName} <${smtpEmail}>` : PROD_FROM();
  const replyTo   = coEmailAddr || undefined;
  console.log(`[sendInvoiceEmail] Sending to ${toEmail} — invoice ${invoiceNum}`);
  // See the matching note in sendEstimateEmailProd.
  const audit = require('../lib/invoiceEmailDeliveryAudit.cjs');
  const communicationId = await audit.beginInvoiceEmailAttempt(pool, {
    companyId, invoiceId: invoice.id, to: toEmail, contactName: customerName,
    subject, html, actorEmail: params?.context?.actorEmail,
  });
  let result;
  try {
    result = await sendViaResendProd({ from: fromAddr, to: toEmail, subject, html, replyTo, context: params?.context, correlationId: communicationId, ...(attachments.length ? { attachments } : {}) });
  } catch (error) {
    await audit.finishInvoiceEmailAttempt(pool, communicationId, { error }).catch(auditError =>
      console.warn('[sendInvoiceEmail] Could not record failed attempt:', auditError.message));
    throw error;
  }
  let trackingDegraded = false;
  try {
    ({ trackingDegraded } = await audit.finishInvoiceEmailAttempt(pool, communicationId, { result }));
  } catch (auditError) {
    console.warn('[sendInvoiceEmail] Provider accepted email but tracking update failed:', auditError.message);
    trackingDegraded = true;
  }
  return { ...result, communicationId, deliveryStatus: 'submitted', ...(trackingDegraded ? { deliveryTrackingDegraded: true } : {}) };
}

async function handleSendEmail(req, res) {
  let composeAudit = null;
  let trackingDegraded = false;
  try {
    const body = await readJsonBody(req);
    const { getUserFromRequest } = await getPluginAuthHelpers();
    const caller = await getUserFromRequest(req);
    if (!caller?.email) {
      sendJson(res, { error: 'Authentication required' }, 401);
      return;
    }
    const prodDb = require('./prod-db.cjs');
    const impersonationContext = await require('../lib/tenantGuard.cjs')
      .resolveRequestContext(req, prodDb.getPool());
    if (impersonationContext.isImpersonating) {
      sendJson(res, { error: 'Sending email is blocked during an impersonation session' }, 403);
      return;
    }
    // The browser may request its active/impersonated tenant through the
    // standard header. It remains untrusted until the membership check below;
    // request body tenant/sender fields are never used.
    const companyId = req.headers?.['x-company-id'] || caller.company_id;
    if (!companyId) {
      sendJson(res, { error: 'No company is selected' }, 403);
      return;
    }
    await authorizeCompanyEmailSenderProd(req, companyId);
    const { to, subject, body: emailBody, html, cc, replyTo, contactName } = body || {};
    if (!to || !subject) {
      sendJson(res, { error: 'to and subject are required' }, 400);
      return;
    }
    const recipients = Array.isArray(to) ? to : [to];
    const manualSend = require('../lib/manualSendPolicy.cjs').isAuthenticatedManualSend(
      { manualSend: body?.manualSend, __externalCall: true }, req, caller,
    );
    if (recipients.length === 1 && !manualSend) {
      const staffQuietHours = await require('../lib/notificationQuietHours.cjs')
        .getStaffNotificationQuietHours(prodDb.getPool(), companyId, { email: recipients[0] });
      if (staffQuietHours.active) {
        sendJson(res, {
          success: false, skipped: true, reason: 'company_notification_quiet_hours',
          deferred_until: staffQuietHours.deferredUntil,
        });
        return;
      }
    }
    const company = await prodDb.getPool().query(
      'SELECT company_name, name FROM companies WHERE id = $1 LIMIT 1', [companyId],
    );
    const companyName = String(company.rows[0]?.company_name || company.rows[0]?.name || 'CompanySync')
      .replace(/[<>"\r\n]/g, '').trim() || 'CompanySync';
    // Create the visible communication record before contacting the provider.
    // This is intentionally awaited: a message must never be sent if it cannot
    // be attributed to the staff member and company that initiated it.
    // Persisted BEFORE the send and echoed back by the provider on every
    // delivery callback. It is the correlation that survives a database outage
    // between provider acceptance and writing the provider's own message id.
    const correlationId = crypto.randomUUID();
    composeAudit = {
      id: crypto.randomUUID(), companyId, actorEmail: caller.email, to, contactName,
      subject, body: emailBody || html || '', cc, replyTo, correlationId,
    };
    await recordStaffComposeEmail(composeAudit, 'pending');
    const result = await sendEmailWithData({
      to, subject, body: emailBody, html, cc, replyTo, correlationId,
      // Sender address and attribution are derived server-side, never supplied
      // by the caller. The transport will also record this terminal attempt.
      from: `${companyName} <${(PROD_FROM().match(/<([^>]+)>/) || [null, PROD_FROM()])[1]}>`,
      companyId,
      context: { companyId, actorEmail: caller.email, source: 'staff_compose' },
    }, companyId);
    try {
      await recordStaffComposeEmail(composeAudit, 'sent', {
        provider: result.provider,
        provider_message_id: result.id,
        // The provider accepted the request; nothing about the inbox is known
        // yet. The delivery webhook overwrites this when the outcome arrives.
        delivery_status: 'submitted',
        delivery_status_at: new Date().toISOString(),
      });
      // A delivery callback can beat this update. Apply anything already waiting
      // on this provider message id instead of losing it.
      await require('../lib/emailDeliveryWebhook.cjs')
        .applyPendingDeliveryEvents({ pool: require('./prod-db.cjs').getPool(), messageId: result.id });
    } catch (auditError) {
      // Provider acceptance has already happened. Do not falsely report a
      // failed send (and invite a duplicate retry). But the pending audit row
      // on its own is NOT reconcilable: without the provider message id no
      // callback can ever find it, so queue that association for repair.
      console.error('[Integrations] Could not finalize staff compose audit:', auditError.message);
      const repair = await require('../lib/emailDeliveryWebhook.cjs').associateProviderMessage({
        communicationId: composeAudit.id,
        provider: result.provider,
        messageId: result.id,
      }, { pool: require('./prod-db.cjs').getPool() }).catch(() => ({ ok: false, queued: false }));
      // Even if that repair could not be queued (the database is down, not just
      // this statement), the pre-send record already carries the correlation id
      // the provider echoes back, so the outcome is still recoverable.
      if (!repair.ok) trackingDegraded = true;
    }
    // communicationId lets the sender open the exact record and watch the real
    // outcome, instead of being told "sent" and left to assume delivery.
    sendJson(res, {
      ...result,
      communicationId: composeAudit.id,
      deliveryStatus: 'submitted',
      // The mail was accepted either way; this only says the outcome may take a
      // recovery pass to show up. It must never read as "resend this".
      ...(trackingDegraded ? { deliveryTrackingDegraded: true } : {}),
    });
  } catch (err) {
    if (composeAudit) {
      try {
        await recordStaffComposeEmail(composeAudit, 'failed', { error: String(err.message || err).slice(0, 500) });
      } catch (auditError) {
        console.error('[Integrations] Could not record failed staff compose email:', auditError.message);
      }
    }
    console.error('[Integrations] SendEmail error:', err.message);
    const status = err.code?.includes('RATE_LIMIT') ? 429
      : /access to send email|Authentication required|No company is selected/i.test(err.message) ? 403
        : err.noRetry ? 400 : 502;
    sendJson(res, { error: err.message || 'Failed to send email. Please try again later.' }, status);
  }
}

async function recordStaffComposeEmail(audit, status, outcome = {}) {
  const recipients = Array.isArray(audit.to) ? audit.to : [audit.to];
  const contactEmail = recipients.filter(Boolean).join(', ');
  const contactName = String(audit.contactName || contactEmail.split('@')[0] || 'Email recipient').slice(0, 200);
  // delivery_status is the canonical email outcome and is deliberately separate
  // from the send-time status column: 'sent' only ever means the provider
  // accepted the request, never that the recipient received it.
  const STATUS_TO_DELIVERY_STATE = { pending: 'pending', sent: 'submitted', failed: 'failed' };
  // Split deliberately: audit/identity fields are always written, while the
  // send-time state is only an opinion about what we just did. By the time this
  // runs the provider may already have called back with the real outcome.
  const { delivery_status: _ignored, delivery_status_at: _ignoredAt, ...outcomeFields } = outcome;
  const always = {
    source: 'staff_compose',
    actor_email: audit.actorEmail,
    cc: Array.isArray(audit.cc) ? audit.cc : (audit.cc ? [audit.cc] : []),
    reply_to: audit.replyTo || null,
    ...(audit.correlationId ? { delivery_correlation_id: audit.correlationId } : {}),
    ...outcomeFields,
  };
  const optimistic = {
    delivery_status: STATUS_TO_DELIVERY_STATE[status] || status,
    delivery_status_at: new Date().toISOString(),
  };
  const data = { ...always, ...optimistic };
  const pool = require('./prod-db.cjs').getPool();
  if (status === 'pending') {
    await pool.query(
      `INSERT INTO communications
        (id, company_id, type, communication_type, direction, contact_name,
         contact_email, subject, body, message, status, created_by, data, created_at, updated_at)
       VALUES ($1, $2, 'email', 'email', 'outbound', $3, $4, $5, $6, $6, 'pending', $7, $8, NOW(), NOW())`,
      [audit.id, audit.companyId, contactName, contactEmail, audit.subject, audit.body, audit.actorEmail, JSON.stringify(data)],
    );
    return;
  }
  // Never clobber an outcome that arrived while the provider call was in
  // flight: acceptance is the weakest thing we can know and it is written last.
  await require('../lib/emailDeliveryWebhook.cjs').finalizeSendRecord({
    communicationId: audit.id, status, always, optimistic,
  }, { pool });
}

async function handleFunctionInvoke(req, res) {
  try {
    const body = await readJsonBody(req);
    const { functionName, params } = body;
    if (!functionName) { sendJson(res, { error: 'functionName is required' }, 400); return; }
    // Internal `_xxxImpl` helpers are implementation details of a public handler
    // (which does the auth/checkAIUsage gating) — never reachable directly by name,
    // or the gate is trivially bypassed via this unauthenticated RPC endpoint.
    if (typeof functionName === 'string' && functionName.startsWith('_')) {
      sendJson(res, { error: 'Not a callable function', functionName }, 403);
      return;
    }
    console.log(`[Functions] Invoke: ${functionName}`);

    if (functionName === 'sarahBridgeAPI') {
      const result = await handleSarahBridgeAPI(params, req);
      sendJson(res, { data: result });
      return;
    }

    // Provider webhooks are deliberately separate from user authentication. They
    // must present a server-only shared secret, and can only report the two
    // delivery outcomes that may trip the outbound safety circuit breaker.
    if (functionName === 'recordEmailDeliveryEvent') {
      const provided = String(req.headers?.['x-email-webhook-secret'] || '').trim();
      const expected = String(process.env.EMAIL_PROVIDER_WEBHOOK_SECRET || '').trim();
      if (!expected || !provided || provided.length !== expected.length
          || !require('crypto').timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
        sendJson(res, { error: 'Unauthorized webhook' }, 401);
        return;
      }
      const emailHealth = require('../lib/emailProviderHealth.cjs');
      const outcome = emailHealth.reportDeliveryEvent(params || {});
      sendJson(res, { data: outcome });
      return;
    }

    if (functionName === 'lexiChat') {
      const result = await handleLexiChat(params, req);
      sendJson(res, { data: result });
      return;
    }

    // Confirmation is intentionally a distinct, authenticated server action:
    // production must expose it explicitly rather than relying on the generic
    // function fallback, so approved Lexi sequence/packet actions cannot drift
    // from the development route.
    if (functionName === 'executeLexiOrchestration') {
      const handlers = await getFunctionHandlers();
      if (typeof handlers.executeLexiOrchestration !== 'function') {
        sendJson(res, { data: { success: false, error: 'Lexi orchestration is unavailable.' } }, 503);
        return;
      }
      const result = await handlers.executeLexiOrchestration(params || {}, process.env.GOOGLE_GEMINI_API_KEY, req);
      sendJson(res, { data: result });
      return;
    }

    if (functionName === 'sendTaskUpdateToCustomer') {
      const result = await handleSendTaskUpdateToCustomer(params);
      sendJson(res, { data: result });
      return;
    }

    if (functionName === 'getPublicEstimate') {
      try {
        const { id, t } = params || {};
        console.log('[Functions] getPublicEstimate id=', id, 'hasToken=', !!t);
        if (!id) { sendJson(res, { data: { error: 'Missing estimate id' } }); return; }
        const { checkEstimateAccess } = require('../lib/estimateToken.cjs');
        const access = checkEstimateAccess(id, t, 'getPublicEstimate');
        if (!access.ok) {
          console.warn('[Functions] getPublicEstimate token rejected id=', id);
          sendJson(res, { data: { error: 'Unauthorized estimate link' } }); return;
        }
        const prodDb = require('./prod-db.cjs');
        const pool = prodDb.getPool();
        let estRes = await pool.query(`SELECT * FROM estimates WHERE id = $1 LIMIT 1`, [id]);
        console.log('[Functions] getPublicEstimate estimates table rows=', estRes.rows.length);
        if (estRes.rows.length === 0) {
          estRes = await pool.query(
            `SELECT id, company_id, data, created_date FROM generic_entities WHERE LOWER(entity_type) = 'estimate' AND id = $1 LIMIT 1`,
            [id]
          );
          console.log('[Functions] getPublicEstimate generic_entities rows=', estRes.rows.length);
        }
        if (estRes.rows.length === 0) {
          console.warn('[Functions] getPublicEstimate not found id=', id);
          sendJson(res, { data: { error: 'Estimate not found' } }); return;
        }
        const row = estRes.rows[0];
        const jsonbData = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
        const estimate = { ...row, ...jsonbData };
        estimate.id = row.id;
        estimate.created_date = row.created_at || row.created_date;
        const companyId = row.company_id || jsonbData.company_id;
        console.log('[Functions] getPublicEstimate found companyId=', companyId, 'estNum=', estimate.estimate_number);
        let company = {};
        let financing = null;
        if (companyId) {
          const coRes = await pool.query(`SELECT * FROM companies WHERE id = $1 LIMIT 1`, [companyId]);
          if (coRes.rows.length > 0) {
            const co = coRes.rows[0];
            company = { id: co.id, company_name: co.company_name || co.name || '', phone: co.phone || '', email: co.email || '', address: co.address || '', website: co.website || '', logo_url: co.logo_url || co.company_logo || '' };
            const settings = typeof co.settings === 'string' ? JSON.parse(co.settings || '{}') : (co.settings || {});
            if (settings.financing) financing = settings.financing;
          }
        }
        console.log('[Functions] getPublicEstimate returning estimate id=', estimate.id, 'company=', company.company_name);
        sendJson(res, { data: { estimate, company, financing } });
      } catch (err) {
        console.error('[Functions] getPublicEstimate error:', err.message, err.stack);
        sendJson(res, { data: { error: 'Unable to load this estimate. Please try again later.' } });
      }
      return;
    }

    if (functionName === 'getPublicTrainingVideo') {
      try {
        const { videoId } = params || {};
        if (!videoId) { sendJson(res, { data: { error: 'videoId is required' } }); return; }
        const prodDb = require('./prod-db.cjs');
        const pool = prodDb.getPool();
        const tvRes = await pool.query(
          `SELECT id, company_id, data, created_date FROM generic_entities WHERE LOWER(entity_type) = 'trainingvideo' AND id = $1 LIMIT 1`,
          [videoId]
        );
        if (tvRes.rows.length === 0) { sendJson(res, { data: { error: 'Training video not found' } }); return; }
        const row = tvRes.rows[0];
        const d = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
        const video = { id: row.id, company_id: row.company_id, created_date: row.created_date, ...d };
        sendJson(res, { data: { video } });
      } catch (err) {
        console.error('[Functions] getPublicTrainingVideo error:', err.message);
        sendJson(res, { data: { error: 'Unable to load this video. Please try again later.' } });
      }
      return;
    }

    if (functionName === 'syncEstimateAdjustmentToInvoice') {
      try {
        const { estimate_id, new_total, adjustment_amount } = params || {};
        if (!estimate_id) { sendJson(res, { data: { success: false, error: 'estimate_id required' } }); return; }
        const prodDb = require('./prod-db.cjs');
        const pool = prodDb.getPool();
        const invRes = await pool.query(
          `SELECT id, total_amount, amount_paid, items, data FROM invoices WHERE data->>'estimate_id' = $1 ORDER BY created_at DESC LIMIT 1`,
          [estimate_id]
        );
        if (invRes.rows.length === 0) {
          sendJson(res, { data: { success: false, skipped: true, reason: 'No linked invoice found' } });
          return;
        }
        const inv = invRes.rows[0];
        const existingItems = Array.isArray(inv.items) ? inv.items : (typeof inv.items === 'string' ? JSON.parse(inv.items) : []);
        const existingData = typeof inv.data === 'string' ? JSON.parse(inv.data) : (inv.data || {});
        const adj = Number(adjustment_amount) || 0;
        let updatedItems = existingItems.filter(i => i.description !== 'Adjustment');
        if (adj !== 0) {
          updatedItems.push({ description: 'Adjustment', quantity: 1, rate: adj, amount: adj, unit: '', code: '' });
        }
        const newTotal = Number(new_total) || 0;
        const updatedData = { ...existingData, amount: newTotal, adjustment_amount: adj };
        await pool.query(
          `UPDATE invoices SET total_amount = $1, items = $2, data = $3, updated_at = NOW() WHERE id = $4`,
          [newTotal, JSON.stringify(updatedItems), JSON.stringify(updatedData), inv.id]
        );
        console.log(`[syncEstimateAdjustmentToInvoice] Invoice ${inv.id}: total ${inv.total_amount} → ${newTotal}, adj=${adj}`);
        sendJson(res, { data: { success: true, invoice_id: inv.id, old_total: inv.total_amount, new_total: newTotal } });
      } catch (err) {
        console.error('[syncEstimateAdjustmentToInvoice] Error:', err.message);
        sendJson(res, { data: { success: false, error: err.message } });
      }
      return;
    }

    if (functionName === 'updatePublicEstimateStatus') {
      try {
        const { id, status, t } = params || {};
        if (!id || !status) { sendJson(res, { data: { error: 'Missing id or status' } }); return; }
        if (!['accepted', 'declined'].includes(status)) { sendJson(res, { data: { error: 'Invalid status' } }); return; }
        const { checkEstimateAccess } = require('../lib/estimateToken.cjs');
        const access = checkEstimateAccess(id, t, 'updatePublicEstimateStatus');
        if (!access.ok) { sendJson(res, { data: { error: 'Unauthorized estimate link' } }); return; }
        const prodDb = require('./prod-db.cjs');
        const pool = prodDb.getPool();
        let estRes = await pool.query(
          `SELECT id, company_id, customer_name, customer_email, estimate_number, total_amount, data FROM estimates WHERE id = $1 LIMIT 1`,
          [id]
        );
        let useGeneric = false;
        if (estRes.rows.length === 0) {
          estRes = await pool.query(
            `SELECT id, company_id, data FROM generic_entities WHERE LOWER(entity_type) = 'estimate' AND id = $1 LIMIT 1`,
            [id]
          );
          useGeneric = true;
        }
        if (estRes.rows.length === 0) { sendJson(res, { data: { error: 'Estimate not found' } }); return; }
        const row = estRes.rows[0];
        const jsonbData = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
        const estimate = { ...jsonbData, ...row };
        if (useGeneric) {
          await pool.query(
            `UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{status}', $1::jsonb), updated_date = NOW() WHERE id = $2`,
            [JSON.stringify(status), id]
          );
        } else {
          await pool.query(`UPDATE estimates SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]);
        }
        sendJson(res, { data: { success: true, status } });
      } catch (err) {
        console.error('[Functions] updatePublicEstimateStatus error:', err.message);
        sendJson(res, { data: { error: 'Unable to update this estimate. Please try again later.' } });
      }
      return;
    }

    if (functionName === 'sendEstimateEmail') {
      try {
        const { caller, companyId } = await authorizeDocumentEmailProd(req, params || {}, 'estimates', 'estimateId');
        const result = await sendEstimateEmailProd({
          ...(params || {}),
          // Overwrite, never merge: the authorized owner must win over whatever
          // company the caller put in the body, or an authorized caller could
          // send using another tenant's SMTP, branding and rate bucket.
          companyId, company_id: companyId,
          context: { companyId, actorEmail: caller.email, source: 'sendEstimateEmail' },
        }, companyId, req);
        sendJson(res, { data: result });
      } catch (emailErr) {
        console.error('[Functions] sendEstimateEmail error:', emailErr.message);
        sendJson(res, { error: emailErr.message }, 500);
      }
      return;
    }

    if (functionName === 'sendInvoiceEmail') {
      try {
        const { caller, companyId } = await authorizeDocumentEmailProd(req, params || {}, 'invoices', 'invoiceId');
        const result = await sendInvoiceEmailProd({
          ...(params || {}),
          companyId, company_id: companyId,
          context: { companyId, actorEmail: caller.email, source: 'sendInvoiceEmail' },
        }, companyId);
        sendJson(res, { data: result });
      } catch (emailErr) {
        console.error('[Functions] sendInvoiceEmail error:', emailErr.message);
        sendJson(res, { error: emailErr.message }, 500);
      }
      return;
    }

    if (functionName === 'sendTaskEmail' || functionName === 'sendEmailFromCRM') {
      try {
        const requestedCompanyId = params?.companyId || params?.company_id || req.headers?.['x-company-id'];
        const caller = await authorizeCompanyEmailSenderProd(req, requestedCompanyId);
        const toArr = Array.isArray(params?.to) ? params.to : [params?.to];
        const manualSend = require('../lib/manualSendPolicy.cjs').isAuthenticatedManualSend(
          { manualSend: params?.manualSend, __externalCall: true }, req, caller,
        );
        if (toArr.length === 1 && !manualSend) {
          const staffQuietHours = await require('../lib/notificationQuietHours.cjs')
            .getStaffNotificationQuietHours(require('./prod-db.cjs').getPool(), requestedCompanyId, { email: toArr[0] });
          if (staffQuietHours.active) {
            sendJson(res, { data: {
              success: false, skipped: true, reason: 'company_notification_quiet_hours',
              deferred_until: staffQuietHours.deferredUntil,
            } });
            return;
          }
        }
        const result = await sendEmailWithData({
          ...(params || {}),
          companyId: requestedCompanyId,
          context: { companyId: requestedCompanyId, actorEmail: caller.email, source: functionName },
        }, requestedCompanyId);
        sendJson(res, { data: result });
      } catch (emailErr) {
        console.error('[Functions] Email send error:', emailErr.message);
        sendJson(res, { error: emailErr.message }, 500);
      }
      return;
    }

    if (functionName === 'sendInspectionReport') {
      try {
        const { getUserFromRequest } = await getPluginAuthHelpers();
        const caller = await getUserFromRequest(req);
        if (!caller?.email) {
          sendJson(res, { data: { success: false, status: 'failed', error: 'Authentication required.' } }, 401);
          return;
        }
        const result = await require('../lib/inspectionReportDelivery.cjs').sendInspectionReportEmails({
          params: params || {},
          req,
          pool: require('./prod-db.cjs').getPool(),
          caller,
          sendEmail: (email) => sendViaResendProd(email),
        });
        sendJson(res, { data: result });
      } catch (error) {
        console.error('[sendInspectionReport] Failed:', error.message);
        sendJson(res, {
          data: {
            success: false,
            status: 'failed',
            error: error.statusCode ? error.message : 'The report email could not be submitted.',
          },
        });
      }
      return;
    }

    if (functionName === 'revokeInspectionReportLinks') {
      try {
        const { getUserFromRequest } = await getPluginAuthHelpers();
        const caller = await getUserFromRequest(req);
        if (!caller?.email) {
          sendJson(res, { data: { success: false, error: 'Authentication required.' } }, 401);
          return;
        }
        const result = await require('../lib/inspectionReportDelivery.cjs').revokeInspectionReportLinks({
          params: params || {},
          pool: require('./prod-db.cjs').getPool(),
          caller,
        });
        sendJson(res, { data: result });
      } catch (error) {
        sendJson(res, {
          data: {
            success: false,
            error: error.statusCode ? error.message : 'The report links could not be revoked.',
          },
        });
      }
      return;
    }

    if (false && functionName === 'sendInspectionReport') {
      try {
        const prodDb = require('./prod-db.cjs');
        const pool = prodDb.getPool();
        const {
          inspectionJobId,
          sendToClient = false,
          clientEmail: explicitClientEmail = null,
          sendToAdjuster = false,
          adjusterEmail = null,
          sendToProductionManager = false,
          productionManagerEmail: explicitPmEmail = null,
          sendToSalesRep = false,
          salesRepEmail: explicitSalesRepEmail = null,
          sendToCustomEmails = false,
          customEmails = [],
          pdfBase64 = null,
          pdfUrl = null,
        } = params || {};
        console.log('[sendInspectionReport] Params received:', JSON.stringify({ inspectionJobId, sendToClient, clientEmail: explicitClientEmail, sendToAdjuster, adjusterEmail, sendToProductionManager, productionManagerEmail: explicitPmEmail, sendToSalesRep, salesRepEmail: explicitSalesRepEmail, sendToCustomEmails, customEmails, hasPdfUrl: !!pdfUrl, hasPdfBase64: !!pdfBase64 }));

        if (!inspectionJobId) { sendJson(res, { data: { success: false, error: 'Missing inspectionJobId' } }); return; }

        const jobRes = await pool.query(
          `SELECT * FROM generic_entities WHERE entity_type = 'InspectionJob' AND id = $1 LIMIT 1`,
          [inspectionJobId]
        );
        if (!jobRes.rows.length) { sendJson(res, { data: { success: false, error: 'Inspection job not found' } }); return; }

        const jobRow = jobRes.rows[0];
        const job = typeof jobRow.data === 'string' ? JSON.parse(jobRow.data) : (jobRow.data || {});
        const companyId = jobRow.company_id || job.company_id;

        let companyName = 'Your Company';
        let companyPhone = '';
        let companyEmail = '';
        let productionManagerEmail = null;

        if (companyId) {
          const compRes = await pool.query(`SELECT * FROM companies WHERE id = $1 LIMIT 1`, [companyId]);
          const company = compRes.rows[0] || {};
          companyName = company.name || companyName;
          companyPhone = company.phone || '';
          companyEmail = company.email || '';

          if (explicitPmEmail) {
            productionManagerEmail = explicitPmEmail;
          } else {
            const pmRes = await pool.query(
              `SELECT user_email FROM staff_profiles WHERE company_id = $1 AND (role = 'production_manager' OR role = 'Production Manager') LIMIT 1`,
              [companyId]
            );
            if (pmRes.rows.length) {
              productionManagerEmail = pmRes.rows[0].user_email;
            } else {
              const adminRes = await pool.query(
                `SELECT user_email FROM staff_profiles WHERE company_id = $1 AND (is_administrator = true OR role = 'admin' OR role = 'owner') LIMIT 1`,
                [companyId]
              );
              if (adminRes.rows.length) productionManagerEmail = adminRes.rows[0].user_email;
              else productionManagerEmail = company.created_by || company.email || null;
            }
          }
        }

        const clientName = job.client_name || 'Client';
        const address = job.property_address || 'Property';
        const claimNumber = job.insurance_claim_number || '';
        const fromAddr = process.env.EMAIL_FROM || `${companyName} <noreply@companysync.io>`;

        const makeHtml = (recipientLabel) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;border-radius:12px;overflow:hidden">
  <div style="background:#1e40af;padding:28px 32px;color:white">
    <h1 style="margin:0;font-size:22px">&#x1F4C4; Inspection Report</h1>
    <p style="margin:8px 0 0;opacity:0.85;font-size:14px">${companyName}</p>
  </div>
  <div style="padding:28px 32px;background:white">
    <p style="font-size:16px;color:#1f2937">Hi ${recipientLabel},</p>
    <p style="color:#374151">Please find the inspection report attached for the following property:</p>
    <div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:8px;padding:20px;margin:20px 0">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;width:140px">Client</td><td style="padding:6px 0;font-weight:600;color:#111827">${clientName}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Address</td><td style="padding:6px 0;font-weight:600;color:#111827">&#x1F4CD; ${address}</td></tr>
        ${claimNumber ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px">Claim #</td><td style="padding:6px 0;color:#111827">${claimNumber}</td></tr>` : ''}
      </table>
    </div>
    <p style="color:#6b7280;font-size:13px">The full inspection report is attached as a PDF to this email.</p>
  </div>
  <div style="padding:16px 32px;background:#f1f5f9;text-align:center">
    <p style="color:#94a3b8;font-size:12px;margin:0">${companyName}${companyPhone ? ' · ' + companyPhone : ''}${companyEmail ? ' · ' + companyEmail : ''}</p>
  </div>
</div>`;

        // Build Resend attachment: prefer URL (Resend fetches it), fall back to inline base64
        const pdfFilename = `InspectionReport_${(clientName || 'Client').replace(/\s+/g, '_')}.pdf`;
        const rAttachmentBase = pdfUrl
          ? [{ filename: pdfFilename, path: pdfUrl }]
          : pdfBase64
            ? [{ filename: pdfFilename, content: pdfBase64 }]
            : undefined;

        const sendOne = async (to, label) => {
          if (!to) return false;
          try {
            await sendViaResendProd({
              from: fromAddr,
              to: [to],
              subject: `Inspection Report — ${clientName} | ${address}`,
              html: makeHtml(label),
              ...(rAttachmentBase ? { attachments: rAttachmentBase } : {}),
            });
            console.log(`[sendInspectionReport] Sent to ${label} <${to}>`);
            return true;
          } catch (e) {
            console.error(`[sendInspectionReport] Failed to send to ${label} <${to}>:`, e.message);
            return false;
          }
        };

        const result = { success: false, client_sent: false, adjuster_sent: false, production_manager_sent: false, sales_rep_sent: false, custom_sent: false, custom_count: 0 };

        const resolvedClientEmail = explicitClientEmail || job.client_email || null;
        const resolvedSalesRepEmail = explicitSalesRepEmail || job.sales_rep_email || null;
        console.log('[sendInspectionReport] Resolved emails:', JSON.stringify({ resolvedClientEmail, adjusterEmail, productionManagerEmail, resolvedSalesRepEmail }));
        if (sendToClient && resolvedClientEmail) result.client_sent = await sendOne(resolvedClientEmail, clientName || 'Client');
        if (sendToAdjuster && adjusterEmail) result.adjuster_sent = await sendOne(adjusterEmail, 'Insurance Adjuster');
        if (sendToProductionManager && productionManagerEmail) result.production_manager_sent = await sendOne(productionManagerEmail, 'Production Manager');
        if (sendToSalesRep && resolvedSalesRepEmail) result.sales_rep_sent = await sendOne(resolvedSalesRepEmail, 'Sales Rep');
        if (sendToCustomEmails) {
          // Accept either a comma-separated string or an array from the frontend
          const customList = (
            typeof customEmails === 'string'
              ? customEmails.split(',')
              : Array.isArray(customEmails) ? customEmails : []
          ).map(e => (e || '').trim()).filter(Boolean);
          for (const email of customList) {
            if (await sendOne(email, 'Team Member')) result.custom_count++;
          }
          result.custom_sent = result.custom_count > 0;
        }

        result.success = result.client_sent || result.adjuster_sent || result.production_manager_sent || result.sales_rep_sent || result.custom_sent;
        if (!result.success) result.error = 'No emails were sent — check recipient emails and email provider configuration';

        console.log('[sendInspectionReport] Result:', result);
        sendJson(res, { data: result });
      } catch (irErr) {
        console.error('[sendInspectionReport] Error:', irErr.message);
        sendJson(res, { data: { success: false, error: irErr.message } });
      }
      return;
    }

    if (functionName === 'fetchStormDataV2') {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const result = await stormFunctions.fetchStormDataV2(pool, params || {});
      sendJson(res, { data: result });
      return;
    }

    if (functionName === 'getStormsInArea') {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const result = await stormFunctions.getStormsInArea(pool, params || {});
      sendJson(res, { data: result });
      return;
    }

    if (functionName === 'updateStormSecondaryAreas') {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const result = await stormFunctions.updateStormSecondaryAreas(pool, params || {});
      sendJson(res, { data: result });
      return;
    }

    if (functionName === 'fetchNWSActiveAlerts') {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const states = params?.states || ['OH'];
      const result = await stormFunctions.fetchNWSActiveAlerts(pool, states);
      sendJson(res, { data: result });
      return;
    }

    // aiRoofMeasurement / geminiRoofMeasurement intentionally have NO dedicated
    // prod intercept here — they fall through to the shared vite functionHandlers
    // registry below (getFunctionHandlers), same pattern as runLaunchTest /
    // bulkGeocodeEntities. This keeps the usage gate, auth check, and Mardale/2184
    // override removal in ONE place instead of two drifting copies.

    if (functionName === 'analyzeSidingMeasurement') {
      const result = await handleAnalyzeSidingMeasurement(params || {});
      sendJson(res, { data: result });
      return;
    }

    if (functionName === 'getGoogleMapsApiKey') {
      const key = process.env.GOOGLE_MAPS_API_KEY || "AIzaSyD-TEST-KEY-FOR-TRIALS";
      sendJson(res, { data: { key, apiKey: key, api_key: key } });
      return;
    }

    if (functionName === 'aiGenerateTerritories') {
      const result = await handleAIGenerateTerritories(params);
      sendJson(res, { data: result });
      return;
    }

    if (functionName === 'fixPaymentDataCorruption') {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const { company_id } = params || {};
      if (!company_id) { sendJson(res, { data: { success: false, error: 'company_id required' } }); return; }
      // AuthZ: caller must be an authenticated member of the target company —
      // this handler bulk-mutates payments/invoices, never trust client company_id alone.
      const prodAuth = require('./prod-auth.cjs');
      const session = await prodAuth.getSessionFromRequest(req, pool);
      const callerEmail = session?.user?.email || session?.email || null;
      if (!callerEmail) { sendJson(res, { data: { success: false, error: 'Not authenticated' } }, 401); return; }
      const memberRes = await pool.query(
        `SELECT 1 FROM staff_profiles WHERE company_id = $1 AND (LOWER(user_email) = LOWER($2) OR LOWER(email) = LOWER($2)) LIMIT 1`,
        [company_id, callerEmail]
      );
      const ownerRes = memberRes.rows.length ? { rows: [1] } : await pool.query(
        `SELECT 1 FROM companies WHERE id = $1 AND LOWER(created_by) = LOWER($2) LIMIT 1`,
        [company_id, callerEmail]
      );
      if (!memberRes.rows.length && !ownerRes.rows.length) {
        sendJson(res, { data: { success: false, error: 'Not authorized for this company' } }, 403);
        return;
      }
      console.log('[Functions] fixPaymentDataCorruption inline for company:', company_id);
      const changes = [];
      const affectedInvoiceIds = new Set();
      try {
        // STEP 1: Find payments whose customer_name doesn't match their linked invoice's customer_name
        const mismatchRes = await pool.query(`
          SELECT p.id AS payment_id, p.data->>'payment_number' AS payment_number,
                 p.customer_name AS payment_customer, p.invoice_id AS wrong_invoice_id,
                 p.invoice_number AS wrong_invoice_number, p.amount, i.customer_name AS invoice_customer
          FROM payments p JOIN invoices i ON i.id = p.invoice_id
          WHERE p.company_id = $1 AND i.company_id = $1
            AND p.status NOT IN ('failed','refunded')
            AND LOWER(TRIM(p.customer_name)) != LOWER(TRIM(i.customer_name))
        `, [company_id]);
        console.log(`[fixPaymentDataCorruption] ${mismatchRes.rows.length} cross-customer payments`);
        for (const row of mismatchRes.rows) {
          // Unlink first. STEP 2 will only relink when it finds a safe,
          // balance-aware match — never merely the newest customer invoice.
          await pool.query(`UPDATE payments SET invoice_id = NULL, invoice_number = NULL, updated_at = NOW() WHERE id = $1`,
            [row.payment_id]);
          affectedInvoiceIds.add(row.wrong_invoice_id);
          changes.push({ action: 'unlinked_cross_customer', payment_number: row.payment_number, amount: row.amount, payment_customer: row.payment_customer, was_on: row.wrong_invoice_number });
        }
        // STEP 2: Link only payments that have one safe invoice match. Never guess
        // based solely on the customer's most-recent invoice.
        const unlinkedRes = await pool.query(
          `SELECT id, customer_name, amount, invoice_number, data->>'payment_number' AS payment_number FROM payments WHERE company_id = $1 AND (invoice_id IS NULL OR invoice_id = '') AND COALESCE(status, 'received') = 'received' AND customer_name IS NOT NULL AND customer_name != ''`,
          [company_id]
        );
        console.log(`[fixPaymentDataCorruption] ${unlinkedRes.rows.length} unlinked payments`);
        let linkedCount = 0;
        const unfixable = [];
        for (const pay of unlinkedRes.rows) {
          const paymentAmount = Number(pay.amount);
          if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
            const reason = 'payment amount is missing or invalid';
            changes.push({ action: 'no_safe_invoice_match', payment_number: pay.payment_number, customer: pay.customer_name, amount: pay.amount, reason });
            unfixable.push({ customer: pay.customer_name, amount: pay.amount, reason });
            continue;
          }
          const directMatches = pay.invoice_number?.trim()
            ? await pool.query(`SELECT id, invoice_number FROM invoices WHERE company_id = $1 AND invoice_number = $2`, [company_id, pay.invoice_number.trim()])
            : { rows: [] };
          let candidates = [];
          if (directMatches.rows.length === 1) {
            candidates = directMatches.rows;
          } else if (directMatches.rows.length === 0) {
            candidates = (await pool.query(`
              SELECT i.id, i.invoice_number,
                     COALESCE(i.total_amount, 0) - COALESCE(SUM(linked.amount), 0) AS remaining_balance
              FROM invoices i
              LEFT JOIN payments linked ON linked.invoice_id = i.id
                AND COALESCE(linked.status, 'received') = 'received'
              WHERE i.company_id = $1
                AND LOWER(TRIM(i.customer_name)) = LOWER(TRIM($2))
                AND COALESCE(i.status, '') NOT IN ('draft', 'cancelled', 'void', 'paid')
              GROUP BY i.id, i.invoice_number, i.total_amount
              HAVING COALESCE(i.total_amount, 0) - COALESCE(SUM(linked.amount), 0) >= $3 - 0.01
              ORDER BY i.created_at DESC
            `, [company_id, pay.customer_name, paymentAmount])).rows;
          }
          const exactBalanceMatches = candidates.filter(inv =>
            inv.remaining_balance != null &&
            Math.abs(Number(inv.remaining_balance) - Number(pay.amount)) < 0.01
          );
          const inv = exactBalanceMatches.length === 1
            ? exactBalanceMatches[0]
            : (candidates.length === 1 ? candidates[0] : null);
          if (!inv) {
            const reason = directMatches.rows.length > 1
              ? 'the referenced invoice number is duplicated'
              : candidates.length > 1
              ? 'multiple open invoices could accept this payment'
              : 'no open invoice with enough remaining balance';
            changes.push({ action: 'no_safe_invoice_match', payment_number: pay.payment_number, customer: pay.customer_name, amount: pay.amount, reason });
            unfixable.push({ customer: pay.customer_name, amount: pay.amount, reason });
            continue;
          }
          await pool.query(`UPDATE payments SET invoice_id = $1, invoice_number = $2, updated_at = NOW() WHERE id = $3`, [inv.id, inv.invoice_number, pay.id]);
          affectedInvoiceIds.add(inv.id);
          linkedCount++;
          changes.push({ action: 'linked', payment_number: pay.payment_number, customer: pay.customer_name, amount: pay.amount, linked_to: inv.invoice_number });
        }
        // STEP 2b: Repair payments with an invoice_id but blank invoice_number (denormalized-field corruption)
        const repairRes = await pool.query(`
          UPDATE payments p SET invoice_number = i.invoice_number, updated_at = NOW()
          FROM invoices i
          WHERE p.company_id = $1 AND i.id = p.invoice_id AND i.company_id = $1
            AND p.invoice_id IS NOT NULL AND p.invoice_id != ''
            AND (p.invoice_number IS NULL OR TRIM(p.invoice_number) = '')
          RETURNING p.id
        `, [company_id]);
        const repairedCount = repairRes.rows.length;
        if (repairedCount > 0) changes.push({ action: 'backfilled_invoice_number', count: repairedCount });
        // STEP 3: Recalculate all affected invoices
        for (const invoiceId of affectedInvoiceIds) {
          const invRow = await pool.query(`SELECT id, invoice_number, total_amount, status FROM invoices WHERE id = $1`, [invoiceId]);
          if (!invRow.rows[0]) continue;
          const inv = invRow.rows[0];
          const paidRes = await pool.query(`SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE invoice_id = $1 AND COALESCE(status, 'received') = 'received'`, [invoiceId]);
          const totalPaid = parseFloat(paidRes.rows[0].total || 0);
          const invoiceAmount = parseFloat(inv.total_amount || 0);
          const newStatus = totalPaid <= 0 ? (['draft','cancelled'].includes(inv.status) ? inv.status : 'sent') : (invoiceAmount > 0 && totalPaid >= invoiceAmount ? 'paid' : 'partially_paid');
          await pool.query(`UPDATE invoices SET amount_paid = $1, status = $2, updated_at = NOW() WHERE id = $3`, [totalPaid, newStatus, invoiceId]);
          changes.push({ action: 'recalculated', invoice: inv.invoice_number, amount_paid: totalPaid, new_status: newStatus });
        }
        const parts = [];
        if (mismatchRes.rows.length > 0) parts.push(`Fixed ${mismatchRes.rows.length} cross-customer payment${mismatchRes.rows.length === 1 ? '' : 's'}`);
        if (linkedCount > 0) parts.push(`linked ${linkedCount} payment${linkedCount === 1 ? '' : 's'} to invoices`);
        if (repairedCount > 0) parts.push(`repaired ${repairedCount} payment record${repairedCount === 1 ? '' : 's'}`);
        if (affectedInvoiceIds.size > 0) parts.push(`recalculated ${affectedInvoiceIds.size} invoice${affectedInvoiceIds.size === 1 ? '' : 's'}`);
        let summary = parts.length > 0 ? parts.join(', ') + '.' : 'No payments could be auto-fixed.';
        if (unfixable.length > 0) {
          const details = unfixable.map(u => `${u.customer} (${u.reason || 'no matching invoice'})`).join(', ');
          summary += ` ${unfixable.length} payment${unfixable.length === 1 ? '' : 's'} was left unlinked because there was no safe automatic match: ${details}. Review it manually rather than risking a payment on the wrong invoice.`;
        }
        console.log('[fixPaymentDataCorruption] Done:', summary);
        sendJson(res, { data: { success: true, changes, unfixable, summary } });
      } catch (fixErr) {
        console.error('[fixPaymentDataCorruption] Error:', fixErr.message);
        sendJson(res, { data: { success: false, error: fixErr.message } });
      }
      return;
    }

    if (functionName === 'createInvoiceFromUnlinkedPayment') {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const { company_id, payment_id } = params || {};
      if (!company_id || !payment_id) { sendJson(res, { data: { success: false, error: 'company_id and payment_id are required' } }, 400); return; }
      const prodAuth = require('./prod-auth.cjs');
      const session = await prodAuth.getSessionFromRequest(req, pool);
      const callerEmail = session?.data?.passport?.user?.claims?.email
        || session?.user?.email
        || session?.email
        || session?.data?.email
        || null;
      if (!callerEmail) { sendJson(res, { data: { success: false, error: 'Not authenticated' } }, 401); return; }
      const membership = await pool.query(
        `SELECT 1 FROM staff_profiles WHERE company_id = $1
         AND (LOWER(user_email) = LOWER($2) OR LOWER(email) = LOWER($2)) LIMIT 1`,
        [company_id, callerEmail]
      );
      const ownership = membership.rowCount ? { rowCount: 1 } : await pool.query(
        `SELECT 1 FROM companies WHERE id = $1 AND LOWER(created_by) = LOWER($2) LIMIT 1`,
        [company_id, callerEmail]
      );
      if (!membership.rowCount && !ownership.rowCount) { sendJson(res, { data: { success: false, error: 'Not authorized for this company' } }, 403); return; }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const paymentRes = await client.query(
          `SELECT id, customer_id, customer_name, amount, payment_date, status, invoice_id, invoice_number
           FROM payments WHERE id = $1 AND company_id = $2 FOR UPDATE`,
          [payment_id, company_id]
        );
        const payment = paymentRes.rows[0];
        if (!payment) throw new Error('Payment not found');
        if (payment.invoice_id || payment.invoice_number) throw new Error('This payment is already linked to an invoice');
        if (!['received', 'completed'].includes(String(payment.status || 'received').toLowerCase())) {
          throw new Error('Only received payments can create an invoice');
        }
        const amount = Number(payment.amount);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than zero');
        let customerRes = payment.customer_id
          ? await client.query(
              `SELECT id, name, email FROM customers WHERE company_id = $1 AND id = $2 LIMIT 1`,
              [company_id, payment.customer_id]
            )
          : { rows: [], rowCount: 0 };
        if (!customerRes.rowCount && payment.customer_name?.trim()) {
          customerRes = await client.query(
            `SELECT id, name, email FROM customers
             WHERE company_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2)) LIMIT 2`,
            [company_id, payment.customer_name]
          );
        }
        if (customerRes.rowCount !== 1) throw new Error('This payment needs one matching customer before an invoice can be created');
        const customer = customerRes.rows[0];
        // Different payments have different row locks, so serialize invoice
        // creation per customer before checking the zero-invoice invariant.
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          [`customer-invoice:${company_id}:${customer.id}`]
        );
        const existingInvoice = await client.query(
          `SELECT 1 FROM invoices WHERE company_id = $1
           AND (customer_id = $2 OR LOWER(TRIM(customer_name)) = LOWER(TRIM($3))) LIMIT 1`,
          [company_id, customer.id, customer.name]
        );
        if (existingInvoice.rowCount) throw new Error('This customer already has an invoice. Link the payment to the existing invoice instead');
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`invoice-number:${company_id}`]);
        const invoiceYear = new Date().getFullYear();
        const invoicePrefix = `INV-${invoiceYear}-`;
        const nextRes = await client.query(
          `SELECT COALESCE(MAX(
                    CASE
                      WHEN substring(invoice_number FROM '^INV-[0-9]{4}-([0-9]+)$') ~ '^[0-9]{1,9}$'
                      THEN CAST(substring(invoice_number FROM '^INV-[0-9]{4}-([0-9]+)$') AS INTEGER)
                      ELSE 0
                    END
                  ), 0) + 1 AS next_number
           FROM invoices WHERE company_id = $1 AND invoice_number LIKE $2`,
          [company_id, `${invoicePrefix}%`]
        );
        let invoiceSequence = Number(nextRes.rows[0].next_number);
        let invoiceNumber = `${invoicePrefix}${String(invoiceSequence).padStart(4, '0')}`;
        while ((await client.query(
          `SELECT 1 FROM invoices WHERE company_id = $1 AND invoice_number = $2 LIMIT 1`,
          [company_id, invoiceNumber]
        )).rowCount) {
          invoiceSequence += 1;
          invoiceNumber = `${invoicePrefix}${String(invoiceSequence).padStart(4, '0')}`;
        }
        const invoiceId = randomUUID();
        const issueDate = payment.payment_date ? new Date(payment.payment_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
        const items = [{ description: 'Payment received', quantity: 1, rate: amount, amount }];
        await client.query(
          `INSERT INTO invoices (id, company_id, customer_id, customer_name, customer_email, invoice_number,
            status, total_amount, amount_paid, issue_date, items, notes, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'paid', $7, $7, $8, $9::jsonb,
            'Created from an unlinked payment.', $10, NOW(), NOW())`,
          [invoiceId, company_id, customer.id, customer.name, customer.email || null, invoiceNumber, amount, issueDate, JSON.stringify(items), callerEmail]
        );
        const linked = await client.query(
          `UPDATE payments SET invoice_id = $1, invoice_number = $2, customer_id = $3, status = 'received', updated_at = NOW()
           WHERE id = $4 AND company_id = $5 AND (invoice_id IS NULL OR invoice_id = '')
             AND (invoice_number IS NULL OR invoice_number = '')
           RETURNING id`,
          [invoiceId, invoiceNumber, customer.id, payment_id, company_id]
        );
        if (!linked.rowCount) throw new Error('Payment was linked while this invoice was being created');
        const paidRes = await client.query(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM payments
           WHERE invoice_id = $1 AND COALESCE(status, 'received') = 'received'`,
          [invoiceId]
        );
        const amountPaid = Number(paidRes.rows[0].total || 0);
        await client.query(
          `UPDATE invoices SET amount_paid = $1, status = CASE WHEN $1 >= total_amount THEN 'paid' WHEN $1 > 0 THEN 'partially_paid' ELSE 'sent' END, updated_at = NOW() WHERE id = $2`,
          [amountPaid, invoiceId]
        );
        await client.query('COMMIT');
        sendJson(res, { data: { success: true, invoice: { id: invoiceId, invoice_number: invoiceNumber, total_amount: amount, amount_paid: amountPaid }, payment: { id: payment_id, invoice_id: invoiceId, invoice_number: invoiceNumber } } });
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error('[createInvoiceFromUnlinkedPayment] Error:', error.message);
        sendJson(res, { data: { success: false, error: error.message } }, 400);
      } finally {
        client.release();
      }
      return;
    }

    if (functionName === 'markOldInvoicesPaid') {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const { company_id, cutoff_date } = params || {};
      if (!company_id) { sendJson(res, { data: { success: false, error: 'company_id required' } }); return; }
      const cutoff = cutoff_date || '2026-01-01';
      console.log('[Functions] markOldInvoicesPaid for company:', company_id, 'cutoff:', cutoff);
      try {
        const result = await pool.query(`
          UPDATE invoices
          SET status = 'paid', updated_at = NOW()
          WHERE company_id = $1
            AND status = 'partially_paid'
            AND (
              (due_date IS NOT NULL AND due_date < $2::date)
              OR (due_date IS NULL AND created_at < $2::date)
            )
        `, [company_id, cutoff]);
        const count = result.rowCount;
        console.log(`[markOldInvoicesPaid] Marked ${count} invoices as paid`);
        sendJson(res, { data: { success: true, updated: count, summary: `Marked ${count} old invoices as paid (due before ${cutoff}).` } });
      } catch (err) {
        console.error('[markOldInvoicesPaid] Error:', err.message);
        sendJson(res, { data: { success: false, error: err.message } });
      }
      return;
    }

    if (functionName === 'grantStaffAdminAccess') {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const prodAuth = require('./prod-auth.cjs');
      const session = await prodAuth.getSessionFromRequest(req, pool);
      const callerEmail = session?.data?.email;
      if (!callerEmail) { sendJson(res, { data: { success: false, error: 'Not authenticated' } }); return; }
      const { staffEmail, isAdmin, companyId } = params || {};
      if (!staffEmail || !companyId) { sendJson(res, { data: { success: false, error: 'staffEmail and companyId required' } }); return; }
      try {
        // Validate caller is owner or admin
        const callerRes = await pool.query('SELECT is_administrator FROM staff_profiles WHERE (user_email = $1 OR email = $1) LIMIT 1', [callerEmail]);
        const companyRes = await pool.query(`SELECT data->>'created_by' as created_by FROM generic_entities WHERE entity_type = 'Company' AND id = $1 LIMIT 1`, [companyId]);
        const isOwner = companyRes.rows[0]?.created_by === callerEmail;
        const isCallerAdmin = callerRes.rows[0]?.is_administrator === true;
        if (!isOwner && !isCallerAdmin) { sendJson(res, { data: { success: false, error: 'Only owners or admins can grant admin access' } }); return; }
        const adminVal = isAdmin ? true : false;
        await pool.query(`UPDATE staff_profiles SET is_administrator = $1, updated_at = NOW() WHERE (user_email = $2 OR email = $2)`, [adminVal, staffEmail]);
        await pool.query(`UPDATE generic_entities SET data = jsonb_set(data, '{is_administrator}', $1::jsonb), updated_date = NOW() WHERE entity_type = 'StaffProfile' AND (data->>'user_email' = $2 OR data->>'email' = $2)`, [JSON.stringify(adminVal), staffEmail]);
        console.log(`[grantStaffAdminAccess] ${adminVal ? 'Granted' : 'Revoked'} admin for ${staffEmail} by ${callerEmail}`);
        sendJson(res, { data: { success: true } });
      } catch (err) {
        console.error('[grantStaffAdminAccess] Error:', err.message);
        sendJson(res, { data: { success: false, error: err.message } });
      }
      return;
    }

    // generateMarketingCopy intentionally has NO dedicated prod interceptor —
    // it falls through to the shared registry handler in
    // vite-functions-plugin.js (functionHandlers.generateMarketingCopy),
    // which is gated via requireGatedCompany(). A duplicate prod-only copy
    // used to live here with no auth/usage gate at all (found during the
    // Task #656 AI audit remediation — see ai-handler-audit-lessons memory);
    // it was removed rather than re-gated separately, matching the
    // established handleAIRoofMeasurement / runLaunchTest / bulkGeocodeEntities
    // pattern of "one shared handler, no parallel copy to drift".

    if (functionName === 'createCallAssistantRole') {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const { company_id } = params || {};
      const YICN_ID = 'loc_mmdvp1h5_e8i9eb';
      const targetCompany = company_id || YICN_ID;
      const ROLE_NAME = 'Call Assistant';
      const TAMIEKA_TWILIO = '+12167777139';
      try {
        // Upsert the role
        const existingRole = await pool.query(
          `SELECT id FROM generic_entities WHERE entity_type = 'StaffRole' AND company_id = $1 AND LOWER(data->>'name') = LOWER($2) LIMIT 1`,
          [targetCompany, ROLE_NAME]
        );
        let roleId;
        if (existingRole.rows.length > 0) {
          roleId = existingRole.rows[0].id;
          const permissions = {
            dashboard: { view_own: true },
            leads: { view_own: true, create: true, edit_own: true },
            customers: { view_own: true, create: true, edit_own: true },
            projects: { view_own: true },
            tasks: { view_own: true, create: true, edit_own: true },
            reminders: { view_own: true, create: true, edit: true },
            contracts: { view_own: true },
            communication_hub: { view_own: true, audio_call: true, send_sms: true, send_email: true },
            messages: { view_own: true, send: true },
            mailbox: { view_own: true, send: true },
            email_templates: { view: true },
            sms_templates: { view: true },
            zoom_meeting: { view: true, create: true },
            documents: { view_own: true, upload: true },
            knowledge_base: { view: true },
            inspections: { view_own: true },
            lead_inspections: { view_own: true },
            map: { view: true },
            lexi_ai: { view: true, chat: true },
            calendar: { view_own: true, create: true, edit_own: true },
            activity: { view_own: true },
            review_requests: { view_own: true, send: true },
          };
          await pool.query(
            `UPDATE generic_entities SET data = data || $1, updated_date = NOW() WHERE id = $2`,
            [JSON.stringify({ permissions, name: ROLE_NAME }), roleId]
          );
          console.log(`[createCallAssistantRole] Updated existing role: ${roleId}`);
        } else {
          roleId = `role_call_assistant_${Date.now()}`;
          const roleData = {
            id: roleId,
            name: ROLE_NAME,
            description: 'Access to client information (names, addresses, notes, contacts) and all communication tools. No financial data access.',
            company_id: targetCompany,
            permissions: {
              dashboard: { view_own: true },
              leads: { view_own: true, create: true, edit_own: true },
              customers: { view_own: true, create: true, edit_own: true },
              projects: { view_own: true },
              tasks: { view_own: true, create: true, edit_own: true },
              reminders: { view_own: true, create: true, edit: true },
              contracts: { view_own: true },
              communication_hub: { view_own: true, audio_call: true, send_sms: true, send_email: true },
              messages: { view_own: true, send: true },
              mailbox: { view_own: true, send: true },
              email_templates: { view: true },
              sms_templates: { view: true },
              zoom_meeting: { view: true, create: true },
              documents: { view_own: true, upload: true },
              knowledge_base: { view: true },
              inspections: { view_own: true },
              lead_inspections: { view_own: true },
              map: { view: true },
              lexi_ai: { view: true, chat: true },
              calendar: { view_own: true, create: true, edit_own: true },
              activity: { view_own: true },
              review_requests: { view_own: true, send: true },
            },
          };
          await pool.query(
            `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'StaffRole', $2, $3, NOW(), NOW())`,
            [roleId, targetCompany, JSON.stringify(roleData)]
          );
          console.log(`[createCallAssistantRole] Created role: ${roleId}`);
        }

        // Assign to Tamieka Kent in staff_profiles
        const spRow = await pool.query(
          `SELECT id, full_name FROM staff_profiles WHERE twilio_number = $1 AND company_id = $2 LIMIT 1`,
          [TAMIEKA_TWILIO, targetCompany]
        );
        let assigned = false;
        if (spRow.rows.length > 0) {
          await pool.query(
            `UPDATE staff_profiles SET role_id = $1, updated_at = NOW() WHERE id = $2`,
            [roleId, spRow.rows[0].id]
          );
          console.log(`[createCallAssistantRole] Assigned to ${spRow.rows[0].full_name} (staff_profiles)`);
          assigned = true;
        }

        // Also assign in generic_entities StaffProfile
        const geRow = await pool.query(
          `SELECT id FROM generic_entities WHERE entity_type = 'StaffProfile' AND company_id = $1 AND data->>'twilio_number' = $2 LIMIT 1`,
          [targetCompany, TAMIEKA_TWILIO]
        );
        if (geRow.rows.length > 0) {
          await pool.query(
            `UPDATE generic_entities SET data = data || $1, updated_date = NOW() WHERE id = $2`,
            [JSON.stringify({ role_id: roleId, role_name: ROLE_NAME }), geRow.rows[0].id]
          );
          console.log(`[createCallAssistantRole] Assigned to generic_entities StaffProfile ${geRow.rows[0].id}`);
          assigned = true;
        }

        const msg = assigned
          ? `✅ "Call Assistant" role created/updated (id: ${roleId}) and assigned to Tamieka Kent.`
          : `✅ "Call Assistant" role created/updated (id: ${roleId}). Note: Tamieka Kent's profile was not found by Twilio number — role not yet assigned. She may need to log in first or be assigned manually.`;
        sendJson(res, { data: { success: true, message: msg, roleId } });
      } catch (err) {
        console.error('[createCallAssistantRole] Error:', err.message);
        sendJson(res, { data: { success: false, error: err.message } });
      }
      return;
    }

    if (functionName === 'testSarahVoiceCall') {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const prodAuth = require('./prod-auth.cjs');
      const session = await prodAuth.getSessionFromRequest(req, pool);
      if (!session || !session.data) {
        sendJson(res, { data: { success: false, error: 'Authentication required' } });
        return;
      }
      const { phone_number, company_id } = params || {};
      if (!phone_number) { sendJson(res, { data: { success: false, error: 'Phone number is required' } }); return; }

      const tcResult = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'TwilioConfig' AND company_id = $1 LIMIT 1`,
        [company_id]
      );
      const tc = tcResult.rows.length > 0
        ? (typeof tcResult.rows[0].data === 'string' ? JSON.parse(tcResult.rows[0].data) : tcResult.rows[0].data)
        : {};

      let sarahOutboundPhone = '';
      try {
        const settingsRes = await pool.query(
          "SELECT data FROM generic_entities WHERE entity_type = 'AssistantSettings' AND company_id = $1 ORDER BY (LOWER(BTRIM(COALESCE(data->>'assistant_name',''))) <> 'lexi') DESC, (LOWER(BTRIM(COALESCE(data->>'assistant_name',''))) IN ('sarah','')) DESC, COALESCE(updated_date > created_date + interval '5 seconds', false) DESC, updated_date DESC NULLS LAST LIMIT 1",
          [company_id]
        );
        if (settingsRes.rows[0]?.data?.sarah_outbound_phone) {
          sarahOutboundPhone = settingsRes.rows[0].data.sarah_outbound_phone;
        }
      } catch (e) {}

      const twilioSid = tc.account_sid || process.env.TWILIO_ACCOUNT_SID;
      const twilioToken = tc.auth_token || process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = sarahOutboundPhone || tc.main_phone_number || process.env.TWILIO_PHONE_NUMBER;
      if (!twilioSid || !twilioToken || !fromNumber) {
        sendJson(res, { data: { success: false, error: 'Twilio credentials not found. Set up Twilio in Settings first.' } });
        return;
      }

      const host = req ? (req.headers?.['x-forwarded-host'] || req.headers?.host || '') : '';
      const publicHost = host || 'getcompanysync.com';
      const twimlUrl = `https://${publicHost}/api/twilio/outbound-voice?companyId=${encodeURIComponent(company_id)}&leadPhone=${encodeURIComponent(phone_number)}&leadName=Voice+Test&leadService=Test+Call&maxDuration=120`;

      const cleanTo = phone_number.replace(/[^\d+]/g, '');
      const cleanFrom = fromNumber.replace(/[^\d+]/g, '');
      const authStr = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
      const callParams = new URLSearchParams({
        To: cleanTo.startsWith('+') ? cleanTo : `+1${cleanTo}`,
        From: cleanFrom.startsWith('+') ? cleanFrom : `+1${cleanFrom}`,
        Url: twimlUrl,
        Timeout: '30',
      });

      console.log(`[SarahBridge] Test voice call: to=${cleanTo}, from=${cleanFrom}, company=${company_id}`);

      const twilioResp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authStr}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: callParams.toString(),
        }
      );
      const twilioData = await twilioResp.json();
      if (!twilioResp.ok) {
        console.error(`[SarahBridge] Test voice call failed:`, JSON.stringify(twilioData));
        sendJson(res, { data: { success: false, error: twilioData.message || 'Failed to initiate test call', twilio_error_code: twilioData.code } });
        return;
      }

      console.log(`[SarahBridge] Test voice call initiated: SID=${twilioData.sid}`);
      sendJson(res, { data: { success: true, callSid: twilioData.sid } });
      return;
    }

    if (functionName === 'findLeadCustomerDuplicates') {
      const { company_id } = params || {};
      if (!company_id) { sendJson(res, { data: { warnings: [] } }); return; }
      try {
        const prodDb = require('./prod-db.cjs');
        const pool = prodDb.getPool();
        const [leadsResult, customersResult] = await Promise.all([
          pool.query(`SELECT id, name AS full_name, email, phone FROM leads WHERE company_id = $1`, [company_id]),
          pool.query(`SELECT id, name AS full_name, email, phone FROM customers WHERE company_id = $1`, [company_id]),
        ]);
        const leads = leadsResult.rows;
        const customers = customersResult.rows;
        const customerEmailMap = new Map();
        const customerPhoneMap = new Map();
        const customerNameMap = new Map();
        for (const c of customers) {
          if (c.email) customerEmailMap.set(c.email.toLowerCase().trim(), c);
          const phone = (c.phone || '').replace(/\D/g, '');
          if (phone.length >= 7) customerPhoneMap.set(phone, c);
          if (c.full_name) customerNameMap.set(c.full_name.toLowerCase().trim(), c);
        }
        const warnings = [];
        const warnedLeadIds = new Set();
        for (const lead of leads) {
          if (warnedLeadIds.has(lead.id)) continue;
          const emailKey = (lead.email || '').toLowerCase().trim();
          const phoneKey = (lead.phone || '').replace(/\D/g, '');
          const nameKey = (lead.full_name || '').toLowerCase().trim();
          const matchedCustomer =
            (emailKey && customerEmailMap.get(emailKey)) ||
            (phoneKey.length >= 7 && customerPhoneMap.get(phoneKey)) ||
            (nameKey && customerNameMap.get(nameKey));
          if (matchedCustomer) {
            warnedLeadIds.add(lead.id);
            warnings.push({
              leadId: lead.id,
              leadName: lead.full_name || '',
              customerNames: matchedCustomer.full_name || '',
              matchType: emailKey && customerEmailMap.has(emailKey) ? 'email' : phoneKey.length >= 7 && customerPhoneMap.has(phoneKey) ? 'phone' : 'name',
            });
          }
        }
        sendJson(res, { data: { warnings } });
      } catch (err) {
        console.error('[findLeadCustomerDuplicates] Error:', err.message);
        sendJson(res, { data: { warnings: [] } });
      }
      return;
    }

    if (functionName === 'geocodeAddress') {
      const { address } = params || {};
      if (!address) { sendJson(res, { error: 'address is required' }, 400); return; }
      const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
      let googleError = null;
      // Try Google Maps first
      if (googleApiKey) {
        try {
          const geoResp = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleApiKey}`
          );
          const geoData = await geoResp.json();
          if (geoData.status === 'OK' && geoData.results[0]) {
            const loc = geoData.results[0].geometry.location;
            sendJson(res, { data: { lat: loc.lat, lng: loc.lng, formatted_address: geoData.results[0].formatted_address } });
            return;
          }
          googleError = `Google status: ${geoData.status}`;
          console.warn(`[Geocode] Google failed for "${address}": ${googleError}`);
        } catch (e) {
          googleError = e.message;
          console.warn(`[Geocode] Google exception for "${address}":`, e.message);
        }
      }
      // Fallback: OpenStreetMap Nominatim
      try {
        const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
        const nomResp = await fetch(nomUrl, { headers: { 'User-Agent': 'CompanySync/1.0 (getcompanysync.com)' } });
        if (nomResp.ok) {
          const nomData = await nomResp.json();
          if (nomData && nomData.length > 0) {
            sendJson(res, { data: { lat: parseFloat(nomData[0].lat), lng: parseFloat(nomData[0].lon), formatted_address: nomData[0].display_name } });
            return;
          }
        }
      } catch (e) {
        console.warn(`[Geocode] Nominatim exception for "${address}":`, e.message);
      }
      console.warn(`[Geocode] All providers failed for "${address}"`);
      sendJson(res, { error: `Geocoding failed for address: ${address}` }, 400);
      return;
    }

    const handlers = await getFunctionHandlers();
    if (handlers[functionName] && typeof handlers[functionName] === 'function') {
      console.log(`[Functions] Delegating to plugin handler: ${functionName}`);
      // Attach user email to req so plugin handlers can find it via getUserEmail(req)
      if (!req.user?.email) {
        try {
          const prodDb = require('./prod-db.cjs');
          const prodAuth = require('./prod-auth.cjs');
          const pool = prodDb.getPool();
          const session = await prodAuth.getSessionFromRequest(req, pool);
          const sessionEmail = session?.data?.passport?.user?.claims?.email
            || session?.data?.user?.email
            || session?.data?.email;
          if (sessionEmail) {
            req.user = req.user || {};
            req.user.email = sessionEmail;
          }
        } catch (e) {
          console.warn('[Functions] Could not resolve session email:', e.message);
        }
      }
      // See the matching comment in vite-functions-plugin.js: external calls are
      // marked so email handlers can fail closed when a request never reaches them.
      const result = await handlers[functionName]({ ...(params || {}), __externalCall: true }, process.env.GOOGLE_GEMINI_API_KEY, req);
      const { redactUserSecrets } = require('../lib/stripUserSecrets.cjs');
      sendJson(res, { data: redactUserSecrets(result) });
      return;
    }

    if (functionName === 'generateMasterNarration') {
      const { slides = [], videoTitle = '', customInstructions = '', masterNarrationPrompt = '' } = params || {};
      const { getUserFromRequest, checkAIUsage, logUsageEvent } = await getPluginAuthHelpers();
      const gmnCaller = req ? await getUserFromRequest(req) : null;
      if (!gmnCaller?.email) { sendJson(res, { data: { error: 'Authentication required.' } }); return; }
      if (gmnCaller.company_id) {
        const gmnUsage = await checkAIUsage(gmnCaller.company_id);
        if (!gmnUsage.allowed) { sendJson(res, { data: { error: gmnUsage.error } }); return; }
        logUsageEvent(gmnCaller.company_id, 'ai').catch(() => {});
      }
      if (!slides.length) { sendJson(res, { data: { error: 'No slides provided' } }); return; }
      const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
      if (!apiKey) { sendJson(res, { data: { error: 'GOOGLE_GEMINI_API_KEY not configured' } }); return; }
      try {
        console.log(`[Functions] generateMasterNarration: ${slides.length} slides`);
        let slidesContext = '';
        const imageUrls = [];
        slides.forEach((slide, index) => {
          slidesContext += `\n--- SLIDE ${index + 1} ---\n`;
          slidesContext += `TOPIC: ${slide.topic || 'General Overview'}\n`;
          if (slide.focus_area) slidesContext += `FOCUS AREA (Describe this): ${slide.focus_area}\n`;
          if (slide.ignore_area) slidesContext += `IGNORE AREA (Do NOT mention): ${slide.ignore_area}\n`;
          if (slide.caption) slidesContext += `CAPTION: ${slide.caption}\n`;
          if (slide.imageUrl) imageUrls.push(slide.imageUrl);
        });
        const fullInstructions = [masterNarrationPrompt, customInstructions].filter(Boolean).join('\n\n');
        const prompt = `You are a professional software trainer creating a cohesive video tutorial narration.

VIDEO TITLE: "${videoTitle || 'Training Video'}"

${fullInstructions ? `=== USER'S SPECIFIC INSTRUCTIONS (FOLLOW THESE CLOSELY!) ===\n${fullInstructions}\n=== END USER INSTRUCTIONS ===\n` : ''}

YOUR GOAL:
Create a single, flowing narration script where each segment corresponds EXACTLY to the specific slide topic.
${fullInstructions ? `IMPORTANT: The user has provided specific instructions above - prioritize following them!` : ''}

CRITICAL RULES:
1. STRICT TOPIC ADHERENCE: The narration for Slide X must be ONLY about the TOPIC defined for Slide X.
2. IGNORE IRRELEVANT UI: Only describe what is relevant to the slide topic.
3. RESPECT FOCUS/IGNORE: Obey FOCUS AREA and IGNORE AREA instructions exactly.
4. ONE IDEA PER SLIDE: Do not bleed concepts between slides.
5. NO GENERIC FLUFF: Do not end narrations with filler phrases.
6. FIRST SLIDE ONLY gets "Welcome". Slides 2+ must jump straight into their topic.
7. LAST SLIDE (OUTRO): Must conclude the video.
8. NO NAMES: Never mention any specific person's name visible in screenshots.
${(fullInstructions || '').toLowerCase().includes('short') ? '9. LENGTH: User requested SHORT narrations — keep each slide to 1-2 sentences max.' : ''}
${(fullInstructions || '').toLowerCase().includes('long') || (fullInstructions || '').toLowerCase().includes('detailed') ? '9. LENGTH: User requested DETAILED narrations — be thorough and explanatory.' : ''}

SLIDE SEQUENCE:
${slidesContext}

OUTPUT FORMAT — return ONLY valid JSON with a single key "narrations" containing an array of strings, one per slide (${slides.length} total):
{"narrations":["slide 1 narration","slide 2 narration",...]}`;

        const responseJsonSchema = {
          type: 'object',
          properties: { narrations: { type: 'array', items: { type: 'string' } } },
          required: ['narrations']
        };
        const result = await callGeminiWithSchema(apiKey, prompt, { fileUrls: imageUrls, responseJsonSchema, model: 'gemini-2.5-flash' });
        const narrations = result?.narrations || [];
        sendJson(res, { data: { narrations } });
      } catch (err) {
        console.error('[generateMasterNarration] Error:', err.message);
        sendJson(res, { data: { error: err.message } });
      }
      return;
    }

    console.warn(`[Functions] No handler for: ${functionName}`);
    sendJson(res, { data: {}, warning: `Function '${functionName}' not implemented in production` });
  } catch (err) {
    console.error('[Functions] Error:', err.message);
    sendJson(res, { error: 'An unexpected error occurred. Please try again later.' }, 500);
  }
}

async function handleAnalyzeSidingMeasurement(params) {
  const { latitude, longitude, address = '', storyCount = 1, storyHeightFt = 9, openingDeductionPct = 15 } = params;
  const debugLogs = ['[Prod] analyzeSidingMeasurement started'];
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!latitude || !longitude) return { success: false, error: 'Latitude and longitude are required', debug_logs: debugLogs };
  if (!googleApiKey) return { success: false, error: 'GOOGLE_MAPS_API_KEY not configured on this server.', debug_logs: debugLogs };

  let solarData = null;
  for (const quality of ['HIGH', 'MEDIUM', '']) {
    const qp = quality ? `&requiredQuality=${quality}` : '';
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${latitude}&location.longitude=${longitude}${qp}&key=${googleApiKey}`;
    const resp = await fetch(url);
    if (resp.ok) { solarData = await resp.json(); debugLogs.push(`Solar API OK (${quality || 'any'})`); break; }
    else { debugLogs.push(`Solar API ${quality || 'any'}: ${resp.status}`); }
  }
  if (!solarData) return { success: false, error: 'Google Solar API unavailable for this address.', debug_logs: debugLogs };

  const roofSegments = solarData.solarPotential?.roofSegmentStats || [];
  const wholeAreaM2 = solarData.solarPotential?.wholeRoofStats?.areaMeters2 || 0;
  let segSumM2 = 0;
  roofSegments.forEach(s => { segSumM2 += s.stats?.areaMeters2 || 0; });
  const slopeAreaM2 = segSumM2 > 0 ? segSumM2 : wholeAreaM2;

  let pitchDeg = 25, maxSegArea = 0;
  for (const seg of roofSegments) {
    const deg = seg.pitchDegrees ?? seg.tiltDegrees ?? null;
    const area = seg.stats?.areaMeters2 || 0;
    if (deg > 0 && area > maxSegArea) { maxSegArea = area; pitchDeg = deg; }
  }
  const pitchRad = pitchDeg * Math.PI / 180;
  const pitchMultiplier = 1 / Math.cos(pitchRad);
  const pitchVal = Math.round(Math.tan(pitchRad) * 12);
  const pitchStr = `${Math.min(20, Math.max(1, pitchVal))}/12`;

  const flatFootprintM2 = slopeAreaM2 / pitchMultiplier;
  const flatFootprintSqFt = flatFootprintM2 * 10.764;

  let nsSumM2 = 0, ewSumM2 = 0;
  roofSegments.forEach(s => {
    const az = ((s.azimuthDegrees ?? 0) % 360 + 360) % 360;
    const area = s.stats?.areaMeters2 || 0;
    if (az <= 45 || az > 315 || (az > 135 && az <= 225)) nsSumM2 += area;
    else ewSumM2 += area;
  });

  let buildingLengthM, buildingWidthM, dimensionCapped = false;
  if (nsSumM2 > 0 && ewSumM2 > 0) {
    const nsRatio = nsSumM2 / (nsSumM2 + ewSumM2);
    const rawAspect = nsRatio / (1 - nsRatio + 0.001);
    const aspectRatio = Math.max(1.0, Math.min(4.0, rawAspect));
    dimensionCapped = rawAspect > 3.8;
    buildingLengthM = Math.sqrt(flatFootprintM2 * aspectRatio);
    buildingWidthM = flatFootprintM2 / buildingLengthM;
  } else {
    buildingWidthM = Math.sqrt(flatFootprintM2 / 1.5);
    buildingLengthM = buildingWidthM * 1.5;
  }

  const buildingLengthFt = buildingLengthM * 3.2808;
  const buildingWidthFt = buildingWidthM * 3.2808;
  const solarPerimeterFt = 2 * (buildingLengthFt + buildingWidthFt);

  // Try OpenStreetMap for accurate building footprint perimeter
  let osmPerimeterFt = null;
  let osmUsed = false;
  try {
    const osmUrl = `https://overpass-api.de/api/interpreter?data=[out:json];way["building"](around:30,${latitude},${longitude});out geom;`;
    const osmResp = await fetch(osmUrl, { signal: AbortSignal.timeout(6000) });
    if (osmResp.ok) {
      const osmData = await osmResp.json();
      if (osmData.elements && osmData.elements.length > 0) {
        const el = osmData.elements[0];
        if (el.geometry && el.geometry.length >= 3) {
          let perimM = 0;
          for (let i = 0; i < el.geometry.length; i++) {
            const a = el.geometry[i];
            const b = el.geometry[(i + 1) % el.geometry.length];
            const dlat = (b.lat - a.lat) * 111320;
            const dlon = (b.lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
            perimM += Math.sqrt(dlat * dlat + dlon * dlon);
          }
          osmPerimeterFt = perimM * 3.2808;
          osmUsed = true;
          debugLogs.push(`OSM footprint: ${osmPerimeterFt.toFixed(1)}ft (Solar: ${solarPerimeterFt.toFixed(1)}ft)`);
        }
      } else {
        debugLogs.push('OSM: no building within 30m — using Solar perimeter');
      }
    }
  } catch (osmErr) {
    debugLogs.push(`OSM skipped: ${osmErr.message}`);
  }
  const perimeterFt = osmUsed ? osmPerimeterFt : solarPerimeterFt;

  const numSegs = roofSegments.length;
  const nsEwImbalance = Math.abs(nsSumM2 - ewSumM2) / (Math.max(nsSumM2, ewSumM2) + 0.001);
  const isGable = numSegs <= 4 && nsEwImbalance > 0.25;
  const roofType = isGable ? 'gable' : (numSegs <= 6 ? 'hip' : 'complex');

  let gableAreaSqFt = 0;
  if (isGable) {
    const riseM = (buildingWidthM / 2) * Math.tan(pitchRad);
    gableAreaSqFt = (0.5 * buildingWidthM * riseM) * 10.764 * 2;
  }

  const stories = Number(storyCount) || 1;
  const storyHt = Number(storyHeightFt) || 9;
  const openDeduct = Number(openingDeductionPct) || 15;
  const totalWallHeightFt = stories * storyHt;
  const grossWallAreaSqFt = perimeterFt * totalWallHeightFt + gableAreaSqFt;
  const netWallAreaSqFt = grossWallAreaSqFt * (1 - openDeduct / 100);
  const netWallAreaSQ = netWallAreaSqFt / 100;

  const wallTopLf = Math.round(perimeterFt);
  const wallBottomLf = Math.round(perimeterFt);
  const outsideCornersCount = isGable ? 4 : 8;
  const outsideCornersLf = outsideCornersCount * totalWallHeightFt;

  let confidence = 68;
  if (roofSegments.length >= 2) confidence += 4;
  if (roofSegments.length >= 4) confidence += 4;
  if (nsSumM2 > 0 && ewSumM2 > 0) confidence += 5;
  if (flatFootprintSqFt > 300 && flatFootprintSqFt < 6000) confidence += 5;
  if (slopeAreaM2 > 0) confidence += 4;
  if (osmUsed) confidence += 8;
  confidence = Math.min(92, confidence);

  const grade = confidence >= 82 ? 'B' : confidence >= 70 ? 'C' : confidence >= 55 ? 'D' : 'F';
  const tolerancePct = confidence >= 82 ? 10 : confidence >= 70 ? 15 : confidence >= 55 ? 20 : 25;

  let recommendedWastePct = 10;
  let wasteReason = '';
  if (isGable && numSegs <= 4 && outsideCornersCount <= 4) { recommendedWastePct = 8; wasteReason = `Simple gable — straightforward cuts`; }
  else if (!isGable && numSegs <= 6) { recommendedWastePct = 10; wasteReason = `Hip roof — moderate complexity`; }
  else if (numSegs > 6) { recommendedWastePct = 12; wasteReason = `Complex roofline — more cuts`; }
  if (dimensionCapped) wasteReason += ' (building shape uncertain from satellite)';

  const faceArea = (lenFt) => Math.round(lenFt * totalWallHeightFt * (1 - openDeduct / 100));
  const faces = {
    north: { length_ft: Math.round(buildingLengthFt), area_sqft: faceArea(buildingLengthFt) },
    south: { length_ft: Math.round(buildingLengthFt), area_sqft: faceArea(buildingLengthFt) },
    east:  { length_ft: Math.round(buildingWidthFt),  area_sqft: faceArea(buildingWidthFt) },
    west:  { length_ft: Math.round(buildingWidthFt),  area_sqft: faceArea(buildingWidthFt) },
  };

  return {
    success: true,
    wall_area_sqft: Math.round(netWallAreaSqFt),
    wall_area_sq: Math.round(netWallAreaSQ * 100) / 100,
    wall_top_lf: wallTopLf,
    wall_bottom_lf: wallBottomLf,
    outside_corners_count: outsideCornersCount,
    outside_corners_lf: Math.round(outsideCornersLf),
    inside_corners_count: 0,
    inside_corners_lf: 0,
    building_length_ft: Math.round(buildingLengthFt),
    building_width_ft: Math.round(buildingWidthFt),
    perimeter_ft: Math.round(perimeterFt),
    footprint_sqft: Math.round(flatFootprintSqFt),
    story_count: stories,
    story_height_ft: storyHt,
    opening_deduction_pct: openDeduct,
    faces,
    gable_area_sqft: Math.round(gableAreaSqFt),
    gross_wall_area_sqft: Math.round(grossWallAreaSqFt),
    roof_type: roofType,
    pitch: pitchStr,
    overall_confidence: confidence,
    confidence_grade: grade,
    tolerance_pct: tolerancePct,
    dimension_capped: dimensionCapped,
    recommended_waste_pct: recommendedWastePct,
    waste_reason: wasteReason,
    osm_perimeter_used: osmUsed,
    osm_perimeter_ft: osmUsed ? Math.round(osmPerimeterFt) : null,
    solar_perimeter_ft: Math.round(solarPerimeterFt),
    analysis_notes: `${osmUsed ? '📍 OSM footprint' : '📡 Solar-derived'} perimeter: ${Math.round(perimeterFt)}ft. ${roofSegments.length} roof segments. ~${Math.round(buildingLengthFt)}ft × ${Math.round(buildingWidthFt)}ft ${roofType} building. ${stories} stor${stories === 1 ? 'y' : 'ies'} × ${storyHt}ft. ${openDeduct}% opening deduction.`,
    debug_logs: debugLogs
  };
}

async function handleSarahBridgeAPI(params, req) {
  const { action, companyId, data } = params;
  const prodDb = require('./prod-db.cjs');
  const pool = prodDb.getPool();
  console.log(`[SarahBridge] Action: ${action} for company: ${companyId}`);

  const prodAuth = require('./prod-auth.cjs');
  const session = await prodAuth.getSessionFromRequest(req, pool);
  if (!session || !session.data) {
    return { success: false, error: 'Authentication required' };
  }

  if (action === 'enableSarahVoice') {
    const { webhook_url } = data;
    await pool.query(
      `UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{voice_webhook_url}', $1::jsonb), updated_date = NOW() 
       WHERE entity_type = 'TwilioConfig' AND company_id = $2`,
      [JSON.stringify(webhook_url), companyId]
    );
    await pool.query(
      `UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{sarah_voice_enabled}', 'true'), updated_date = NOW() 
       WHERE entity_type = 'TwilioConfig' AND company_id = $1`,
      [companyId]
    );
    return { success: true, message: 'Alex Voice enabled' };
  }

  if (action === 'disableSarahVoice') {
    await pool.query(
      `UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{sarah_voice_enabled}', 'false'), updated_date = NOW() 
       WHERE entity_type = 'TwilioConfig' AND company_id = $1`,
      [companyId]
    );
    return { success: true, message: 'Alex Voice disabled' };
  }

  if (action === 'initiateOutboundCall') {
    const { leadPhone, leadName, leadService, leadAddress } = data || {};
    if (!leadPhone) return { success: false, error: 'Missing leadPhone' };

    const tcResult = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'TwilioConfig' AND company_id = $1 LIMIT 1`,
      [companyId]
    );
    const tc = tcResult.rows.length > 0
      ? (typeof tcResult.rows[0].data === 'string' ? JSON.parse(tcResult.rows[0].data) : tcResult.rows[0].data)
      : {};
    const twilioSid = tc.account_sid || process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = tc.auth_token || process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = tc.main_phone_number || process.env.TWILIO_PHONE_NUMBER;
    if (!twilioSid || !twilioToken || !fromNumber) {
      return { success: false, error: 'Twilio credentials not found. Set up Twilio in Settings first.' };
    }

    const maxDuration = data.maxCallDuration || 600;
    const host = req ? (req.headers?.['x-forwarded-host'] || req.headers?.host || '') : '';
    const publicHost = host || 'getcompanysync.com';
    const twimlUrl = `https://${publicHost}/api/twilio/outbound-voice?companyId=${encodeURIComponent(companyId)}&leadPhone=${encodeURIComponent(leadPhone)}&leadName=${encodeURIComponent(leadName || '')}&leadService=${encodeURIComponent(leadService || '')}&leadAddress=${encodeURIComponent(leadAddress || '')}&maxDuration=${maxDuration}`;

    const cleanTo = leadPhone.replace(/[^\d+]/g, '');
    const cleanFrom = fromNumber.replace(/[^\d+]/g, '');
    const authStr = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
    const callParams = new URLSearchParams({
      To: cleanTo.startsWith('+') ? cleanTo : `+1${cleanTo}`,
      From: cleanFrom.startsWith('+') ? cleanFrom : `+1${cleanFrom}`,
      Url: twimlUrl,
      StatusCallback: `https://${publicHost}/api/sarah-call-status`,
      StatusCallbackEvent: 'initiated ringing answered completed',
      StatusCallbackMethod: 'POST',
      Timeout: '30',
      MachineDetection: 'Enable',
      MachineDetectionTimeout: '5',
    });

    console.log(`[SarahBridge] Initiating outbound call: to=${cleanTo}, from=${cleanFrom}, company=${companyId}, lead=${leadName}`);

    const twilioResp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authStr}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: callParams.toString(),
      }
    );
    const twilioData = await twilioResp.json();
    if (!twilioResp.ok) {
      console.error(`[SarahBridge] Twilio outbound call failed:`, JSON.stringify(twilioData));
      return { success: false, error: twilioData.message || 'Failed to initiate call', twilio_error_code: twilioData.code };
    }

    console.log(`[SarahBridge] Outbound call initiated: SID=${twilioData.sid}`);

    try {
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'Communication', $2, $3, NOW(), NOW())`,
        [
          `comm_out_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          companyId,
          JSON.stringify({
            contact_phone: leadPhone,
            contact_name: leadName || 'Outbound Lead',
            direction: 'outbound',
            communication_type: 'call',
            status: 'initiated',
            call_sid: twilioData.sid,
            notes: `Outbound call to ${leadName || leadPhone}${leadService ? ` - Service: ${leadService}` : ''}`,
            created_date: new Date().toISOString(),
          })
        ]
      );
    } catch (logErr) {
      console.warn('[SarahBridge] Failed to log outbound call:', logErr.message);
    }

    return { success: true, callSid: twilioData.sid, message: `Call initiated to ${leadPhone}` };
  }

  if (action === 'getTwilioConfig') {
    const tcResult = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'TwilioConfig' AND company_id = $1 LIMIT 1`,
      [companyId]
    );
    if (tcResult.rows.length === 0) return {};
    const tc = typeof tcResult.rows[0].data === 'string' ? JSON.parse(tcResult.rows[0].data) : tcResult.rows[0].data;
    const { auth_token, ...safeConfig } = tc;
    return { ...safeConfig, has_auth_token: !!auth_token };
  }

  return { error: 'Unknown action' };
}

async function handleSendTaskUpdateToCustomer(params) {
  const { taskId, taskName, updateText, updatedBy, companyId, companyName, appUrl } = params;
  if (!companyId || !updateText) return { success: false, error: 'Missing required params' };

  const prodDb = require('./prod-db.cjs');
  const pool = prodDb.getPool();
  const results = { emails_sent: 0, sms_sent: 0, errors: [] };

  try {
    let task = null;
    if (taskId) {
      const taskRes = await pool.query('SELECT * FROM tasks WHERE id = $1 AND company_id = $2', [taskId, companyId]);
      task = taskRes.rows[0];
    }

    const custId = task?.customer_id;
    if (!custId) return { success: false, error: 'No customer linked to this task' };

    const custRes = await pool.query('SELECT * FROM customers WHERE id = $1 AND company_id = $2', [parseInt(custId), companyId]);
    const customer = custRes.rows[0];
    if (!customer) return { success: false, error: 'Customer not found' };

    const effectiveTaskName = taskName || task?.name || 'Task Update';
    const effectiveCompanyName = companyName || 'Your Service Provider';

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1e40af; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">Project Update from ${effectiveCompanyName}</h2>
        </div>
        <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p>Hi ${customer.name},</p>
          <p>We have an update on your project:</p>
          <div style="background: #f3f4f6; border-left: 4px solid #1e40af; padding: 15px; margin: 15px 0; border-radius: 4px;">
            <strong>${effectiveTaskName}</strong>
            <p style="margin: 8px 0 0 0;">${updateText}</p>
          </div>
          <p style="color: #6b7280; font-size: 14px;">Updated by: ${updatedBy || 'Team Member'}</p>
          <p>If you have any questions, feel free to reach out to us directly.</p>
          <p>Best regards,<br/><strong>${effectiveCompanyName}</strong></p>
        </div>
      </div>`;

    const smsText = `${effectiveCompanyName} Update: ${effectiveTaskName} — ${updateText.substring(0, 120)}${updateText.length > 120 ? '...' : ''} — Reply with questions.`;

    if (customer.email) {
      try {
        await sendViaResendProd({ from: `${effectiveCompanyName} <noreply@companysync.io>`, to: [customer.email], subject: `Project Update: ${effectiveTaskName}`, html: emailHtml });
        results.emails_sent++;
      } catch (e) { results.errors.push(`Email: ${e.message}`); }
    }

    if (customer.phone) {
      try {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        const from = process.env.TWILIO_PHONE_NUMBER;
        if (sid && token && from) {
          await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
            method: 'POST',
            headers: { 'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ To: customer.phone, From: from, Body: smsText })
          });
          results.sms_sent++;
        }
      } catch (e) { results.errors.push(`SMS: ${e.message}`); }
    }

    if (task?.assigned_to && task.assigned_to !== updatedBy) {
      try {
        const staffRes = await pool.query('SELECT full_name, user_email FROM staff_profiles WHERE user_email = $1 AND company_id = $2', [task.assigned_to, companyId]);
        const staff = staffRes.rows[0];
        if (staff?.user_email) {
          await sendViaResendProd({
            from: `${effectiveCompanyName} <noreply@companysync.io>`,
            to: [staff.user_email],
            subject: `Task Update: ${effectiveTaskName} (${customer.name})`,
            html: `<h3>Task Update: ${effectiveTaskName}</h3><p><strong>Customer:</strong> ${customer.name}</p><p><strong>Update:</strong> ${updateText}</p><p><strong>By:</strong> ${updatedBy || 'Team Member'}</p>${appUrl ? `<p><a href="${appUrl}/tasks">View Task</a></p>` : ''}`,
          });
          results.emails_sent++;
        }
      } catch (e) {}
    }

    try {
      await pool.query(
        `INSERT INTO generic_entities (entity_type, data, created_at, updated_at) VALUES ('Communication', $1, NOW(), NOW())`,
        [JSON.stringify({ company_id: String(companyId), type: 'task_update_notification', direction: 'outbound', customer_id: String(custId), customer_name: customer.name, subject: `Task Update: ${effectiveTaskName}`, body: updateText, sent_by: updatedBy, emails_sent: results.emails_sent, sms_sent: results.sms_sent, status: 'sent' })]
      );
    } catch (e) {}

    console.log(`[TaskUpdate] Sent ${results.emails_sent} emails, ${results.sms_sent} SMS for "${effectiveTaskName}" (customer: ${customer.name})`);
    return { success: true, ...results };
  } catch (err) {
    console.error('[TaskUpdate] Error:', err.message);
    return { success: false, error: err.message };
  }
}

async function handleAIGenerateTerritories(params) {
  const prodDb = require('./prod-db.cjs');
  const pool = prodDb.getPool();
  const { cityName, repEmails, companyId } = params || {};
  if (!cityName) throw new Error('cityName is required');
  if (!repEmails || repEmails.length === 0) throw new Error('At least one rep email is required');
  if (!companyId) throw new Error('companyId is required');

  // Geocode using Nominatim — free, no API key, same service used by the map search in the UI
  const geoRes = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cityName)}&limit=1`,
    { headers: { 'User-Agent': 'CompanySync-RoofingCRM/1.0' } }
  );
  const geoData = await geoRes.json();
  if (!geoData || geoData.length === 0) {
    throw new Error(`Could not find location: "${cityName}". Try a more specific name like "Solon, Ohio".`);
  }

  const centerLat = parseFloat(geoData[0].lat);
  const centerLng = parseFloat(geoData[0].lon);

  const n = repEmails.length;
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
  const radiusLat = 0.08; // ~9 km
  const radiusLng = 0.08 / Math.cos((centerLat * Math.PI) / 180);
  const sectorLabels = n <= 4
    ? ['North', 'East', 'South', 'West'].slice(0, n)
    : Array.from({ length: n }, (_, i) => `Zone ${i + 1}`);

  const createdTerritories = [];
  for (let i = 0; i < n; i++) {
    const email = repEmails[i];
    const startAngle = (360 / n) * i - 90;
    const endAngle = (360 / n) * (i + 1) - 90;

    const points = [{ lat: centerLat, lng: centerLng }];
    for (let deg = startAngle; deg <= endAngle + 0.1; deg += 5) {
      const rad = (deg * Math.PI) / 180;
      points.push({
        lat: centerLat + radiusLat * Math.sin(rad),
        lng: centerLng + radiusLng * Math.cos(rad)
      });
    }
    points.push({ lat: centerLat, lng: centerLng });

    const label = sectorLabels[i] || `Sector ${i + 1}`;
    const genId = `local_${Date.now()}${i}_${Math.random().toString(36).substr(2, 7)}`;

    // Compute midpoint of the arc for a navigable start address
    const midAngle = ((startAngle + endAngle) / 2) * Math.PI / 180;
    const arcCenterLat = centerLat + radiusLat * 0.6 * Math.sin(midAngle);
    const arcCenterLng = centerLng + radiusLng * 0.6 * Math.cos(midAngle);
    const start_address = `${arcCenterLat.toFixed(5)},${arcCenterLng.toFixed(5)}`;
    const end_address = `${centerLat.toFixed(5)},${centerLng.toFixed(5)}`;

    const data = {
      name: `${cityName} - ${label}`,
      description: `${label} territory in ${cityName}`,
      assigned_reps: [email],
      color: colors[i % colors.length],
      boundary_points: points,
      start_address,
      end_address,
      route_notes: `${label} sector of ${cityName}. Start at the outer edge, work inward to the city center.`,
      center_lat: centerLat,
      center_lng: centerLng,
      company_id: String(companyId)
    };

    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Territory', $2, $3, NOW(), NOW())`,
      [genId, String(companyId), JSON.stringify(data)]
    );
    createdTerritories.push({ id: genId, ...data });
  }

  console.log(`[aiGenerateTerritories] Created ${createdTerritories.length} territories for "${cityName}"`);
  return { territories: createdTerritories, cityCenter: { lat: centerLat, lng: centerLng } };
}

async function getGmailTokenForCompany(pool, companyId) {
  const res = await pool.query(
    `SELECT u.gmail_access_token, u.gmail_refresh_token, u.gmail_token_expires_at, u.gmail_email, u.email
     FROM users u
     JOIN companies c ON LOWER(c.created_by) = LOWER(u.email)
     WHERE c.id = $1 AND u.gmail_connected = true AND u.gmail_access_token IS NOT NULL
     LIMIT 1`,
    [String(companyId)]
  );
  if (res.rows.length === 0) return null;
  const u = res.rows[0];
  let token = u.gmail_access_token;
  const expiry = u.gmail_token_expires_at;
  if (expiry && new Date(expiry) < new Date() && u.gmail_refresh_token) {
    try {
      const refreshResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || '', client_secret: process.env.GOOGLE_CLIENT_SECRET || '', refresh_token: u.gmail_refresh_token, grant_type: 'refresh_token' })
      });
      const rd = await refreshResp.json();
      if (!rd.error && rd.access_token) {
        token = rd.access_token;
        const newExp = new Date(Date.now() + (rd.expires_in * 1000)).toISOString();
        await pool.query('UPDATE users SET gmail_access_token = $1, gmail_token_expires_at = $2, updated_at = NOW() WHERE email = $3', [token, newExp, u.email]);
      }
    } catch (refErr) { console.warn('[Gmail] Token refresh failed:', refErr.message); }
  }
  return { token, gmail_email: u.gmail_email, user_email: u.email };
}
async function gmailApiCall(token, path, method, body) {
  method = method || 'GET';
  const opts = { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, opts);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gmail API error ${resp.status}`);
  }
  return resp.json();
}

async function handleLexiChat(params, req) {
  const { message, conversationHistory = [], companyId, userEmail, userName, file_urls } = params;

  // Never trust the client-supplied companyId on its own — this calls a paid
  // model and must be tied to an authenticated member of that company.
  const { getUserFromRequest, checkAIUsage, logUsageEvent } = await getPluginAuthHelpers();
  const prodDbAuth = require('./prod-db.cjs');
  const authPool = prodDbAuth.getPool();
  const caller = req ? await getUserFromRequest(req) : null;
  if (!caller?.email) {
    return { response: "I couldn't verify your account for this company. Please log in and try again.", actions_executed: [], error: 'Authentication required' };
  }
  if (!(caller.is_super_admin === true || caller.platform_role === 'super_admin')) {
    const { rows: access } = await authPool.query(
      `SELECT 1 FROM companies WHERE id = $1 AND LOWER(created_by) = LOWER($2)
       UNION ALL
       SELECT 1 FROM staff_profiles WHERE company_id = $1 AND (LOWER(email) = LOWER($2) OR LOWER(user_email) = LOWER($2))
       LIMIT 1`,
      [companyId, caller.email]
    );
    if (access.length === 0) {
      return { response: "I couldn't verify your account for this company. Please log in and try again.", actions_executed: [], error: 'Access denied for this company' };
    }
  }
  const usageCheck = await checkAIUsage(companyId);
  if (!usageCheck.allowed) {
    return { response: usageCheck.error, actions_executed: [], error: usageCheck.error };
  }

  let apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  try {
    const prodDb = require('./prod-db.cjs');
    if (companyId) {
      const companyKey = await prodDb.getCompanyGeminiKey(companyId);
      if (companyKey) apiKey = companyKey;
    }
  } catch (e) {}
  if (!apiKey) return { response: "AI service is not configured. Please add Google Gemini API key.", error: 'No API key' };

  const prodDb2 = require('./prod-db.cjs');
  const pool = prodDb2.getPool();

  let company = null;
  let customerList = '(No customers yet)';
  let knowledgeBase = '';

  try {
    if (companyId) {
      const compRes = await pool.query('SELECT * FROM companies WHERE id = $1', [companyId]);
      company = compRes.rows[0];
    }
    if (!company) return { response: "I couldn't identify your company. Please make sure you're logged in.", error: 'No company' };

    const actualCompanyId = company.id;
    logUsageEvent(actualCompanyId, 'lexi').catch(() => {});
    let userProfile = null;
    // Identity comes from the authenticated session, never the client body —
    // a company member must not be able to act (or save memories) as a teammate.
    const sessionEmail = caller?.email || null;
    if (sessionEmail || userEmail) {
      const staffByEmail = await pool.query('SELECT * FROM staff_profiles WHERE company_id = $1 AND (LOWER(user_email) = LOWER($2) OR LOWER(email) = LOWER($2)) LIMIT 1', [actualCompanyId, sessionEmail || userEmail]);
      userProfile = staffByEmail.rows[0];
    }
    const effectiveEmail = sessionEmail || userEmail || 'user@company.com';
    // The build/calendar tools below were written against this second name. It
    // was never declared here, so create_build_schedule threw a ReferenceError
    // on every call — Lexi reported an internal error and fell back to a plain
    // calendar event, leaving the Build Schedule empty. One identity source.
    const effectiveUserEmail = effectiveEmail;
    const effectiveName = userName || userProfile?.full_name || 'User';
    const lexiAccess = buildLexiAccessPolicy({ company, userProfile, effectiveEmail });
    const isAdmin = lexiAccess.isAdmin;

    const custRes = await pool.query(
      `SELECT name, email, phone FROM customers WHERE company_id = $1${isAdmin ? '' : ` AND ${ownRecordCondition('customers', '$2')}`} ORDER BY created_at DESC LIMIT 50`,
      isAdmin ? [actualCompanyId] : [actualCompanyId, effectiveEmail]
    );
    if (custRes.rows.length > 0) {
      customerList = custRes.rows.map(c => `${c.name} (${c.email || c.phone || 'no contact'})`).join(', ');
    }

    try {
      // Personal memories are scoped to the session user; only company-level
      // (or legacy unscoped) memories are shared. Calibration categories use a
      // different schema and are never chat context. Keep in lockstep with the
      // dev text handler in vite-functions-plugin.js.
      const memRes = await pool.query(
        `SELECT data FROM generic_entities
         WHERE entity_type = 'AIMemory'
           AND (data->>'company_id') = $1
           AND (data->>'is_active')::boolean = true
           AND data->>'category' NOT IN ('estimator_calibration','job_calibration')
           AND (
             data->>'user_email' = $2
             OR data->>'user_email' IS NULL
             OR data->>'user_email' = ''
             OR data->>'category' = 'company'
           )
         ORDER BY (data->>'importance')::int DESC NULLS LAST LIMIT 100`,
        [String(actualCompanyId), effectiveEmail]
      );
      if (memRes.rows.length > 0) {
        knowledgeBase = '\n\nCOMPANY KNOWLEDGE BASE:\n' +
          memRes.rows
            .map(r => {
              const label = r.data.key || r.data.title || '';
              const detail = r.data.value || r.data.content || '';
              return label || detail ? `- ${label}: ${detail}` : null;
            })
            .filter(Boolean)
            .join('\n');
      }
    } catch (e) {}

    const now = new Date();
    const userTimeZone = 'America/New_York';
    const getUtcOffset = (tz, date = new Date()) => {
      try {
        const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
        const tzStr  = date.toLocaleString('en-US', { timeZone: tz });
        const diffMin = Math.round((new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 60000);
        const sign = diffMin >= 0 ? '+' : '-';
        const abs = Math.abs(diffMin);
        return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
      } catch { return '-05:00'; }
    };
    const tzOffset = getUtcOffset(userTimeZone);
    const currentDateString = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: userTimeZone });
    const todayISO = now.toISOString().split('T')[0];
    const currentTime = now.toLocaleString('en-US', { timeZone: userTimeZone });

    const systemPrompt = buildLexiSystemPrompt({
      companyName: company?.company_name || 'the company',
      effectiveName,
      effectiveEmail,
      isAdmin,
      customerList,
      knowledgeBase,
      recentActivityContext: '',
      currentDateString,
      currentTime,
      userTimeZone,
      tzOffset,
      todayISO,
    });

    const tools = getLexiTools();

    const geminiTools = [{ functionDeclarations: tools }];
    const history = (conversationHistory || []).slice(-10).filter(m => m?.role && m?.content);
    const contents = [];
    for (const msg of history) {
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
    }
    const effectiveMessage = expandFinancialFollowup(message, conversationHistory);
    const userParts = [{ text: effectiveMessage || 'Hello' }];
    if (Array.isArray(file_urls) && file_urls.length > 0) {
      for (const file of file_urls) {
        try {
          const fileUrl = file.url || file;
          const fileName = file.name || 'image';
          const { base64, mimeType } = await fetchFileAsBase64(typeof fileUrl === 'string' ? fileUrl : String(fileUrl));
          if (base64) {
            userParts.push({ inlineData: { mimeType: file.type || mimeType, data: base64 } });
            userParts[0] = { text: `[Attached image: ${fileName} | file_url: ${fileUrl}]\n\n${effectiveMessage || 'Hello'}` };
            console.log(`[Lexi] Loaded image ${fileName} (${mimeType}) for Gemini`);
          }
        } catch (fileErr) {
          console.warn(`[Lexi] Could not load file for Gemini: ${fileErr.message}`);
        }
      }
    }
    contents.push({ role: 'user', parts: userParts });

    const actionsExecuted = [];
    // Records what this turn's tools actually returned so the final reply can
    // be audited against real data instead of trusted.
    const groundingLedger = createGroundingLedger({ userMessage: effectiveMessage || message || '', promptContext: customerList });
    let finalResponse = '';
    let lastToolName = '';
    let lastToolResult = null;
    let maxTurns = 5;

    for (let turn = 0; turn < maxTurns; turn++) {
      const geminiBody = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools: geminiTools,
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
      };
      const requiredRead = turn === 0 ? requiredReadTool(effectiveMessage || message, isAdmin) : null;
      if (requiredRead) geminiBody.toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [requiredRead] } };

      const resp = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) },
        { timeoutMs: 60000 }
      );
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);

      const candidate = data.candidates?.[0];
      if (!candidate) throw new Error('No response from Gemini');

      const parts = candidate.content?.parts || [];
      const textPart = parts.find(p => p.text);
      const functionCallParts = parts.filter(p => p.functionCall);

      if (textPart && functionCallParts.length === 0) finalResponse = textPart.text;
      if (functionCallParts.length === 0) break;

      contents.push({ role: 'model', parts });
      const functionResponseParts = [];
      // Every tool response reaches the model through here so it always
      // carries its grounding envelope and always lands in the ledger.
      const respondedCalls = new WeakSet();
      const pushGroundedToolResponse = (name, toolArgs, result, call) => {
        if (call) {
          if (respondedCalls.has(call)) return;
          respondedCalls.add(call);
        }
        groundingLedger.record(name, toolArgs, result);
        functionResponseParts.push({ functionResponse: { name, response: groundToolResult(name, result) } });
      };

      for (const fc of functionCallParts) {
        const fname = fc.functionCall.name;
        const args = fc.functionCall.args || {};
        console.log(`[Lexi] Tool call: ${fname}`, JSON.stringify(args).substring(0, 200));
        let toolResult = {};

        try {
          if (!isAdmin && !isPermittedRepTool(fname)) {
            toolResult = lexiAccessDenied('I can help with your assigned CRM records and personal calendar, but this company-wide or cross-record action requires an administrator.');
            pushGroundedToolResponse(fname, args, toolResult, fc);
            continue;
          }
          if (fname === 'get_crm_data') {
            const tableMap = { customers: 'customers', leads: 'leads', estimates: 'estimates', invoices: 'invoices', tasks: 'tasks', projects: 'projects', payments: 'payments', staff: 'staff_profiles', calendar_events: 'calendar_events' };
            const table = tableMap[args.data_type];
            if (!table) { toolResult = { error: `Unknown data type: ${args.data_type}` }; }
            else if (!canUseCrmDataType(lexiAccess, args.data_type)) { toolResult = lexiAccessDenied(); }
            else {
              const f = args.filters || {};
              if (args.data_type === 'leads') {
                let sql = `SELECT * FROM leads WHERE company_id = $1`;
                const sqlParams = [actualCompanyId];
                if (!isAdmin) { sqlParams.push(effectiveEmail); sql += ` AND ${ownRecordCondition('leads', `$${sqlParams.length}`)}`; }
                if (f.city) { sqlParams.push(`%${f.city.toLowerCase()}%`); sql += ` AND LOWER(city) LIKE $${sqlParams.length}`; }
                if (f.state) { sqlParams.push(`%${f.state.toLowerCase()}%`); sql += ` AND LOWER(state) LIKE $${sqlParams.length}`; }
                if (f.status) { sqlParams.push(f.status.toLowerCase()); sql += ` AND LOWER(status) = $${sqlParams.length}`; }
                if (f.assigned_to) { sqlParams.push(`%${f.assigned_to.toLowerCase()}%`); sql += ` AND LOWER(assigned_to) LIKE $${sqlParams.length}`; }
                if (f.lead_source) { sqlParams.push(`%${f.lead_source.toLowerCase()}%`); sql += ` AND LOWER(lead_source) LIKE $${sqlParams.length}`; }
                sql += ` ORDER BY created_at DESC NULLS LAST LIMIT 500`;
                const leadsRes = await pool.query(sql, sqlParams);
                const filterDesc = Object.keys(f).length ? ` (filtered by: ${Object.entries(f).map(([k,v]) => `${k}="${v}"`).join(', ')})` : '';
                toolResult = { count: leadsRes.rows.length, filter_applied: f, leads: leadsRes.rows.map(r => ({ name: r.name, status: r.status, phone: r.phone, email: r.email, city: r.city, state: r.state, assigned_to: r.assigned_to, lead_source: r.lead_source })) };
                actionsExecuted.push({ tool_name: 'get_leads', result: `Found ${leadsRes.rows.length} leads${filterDesc}` });
              } else if (args.data_type === 'customers') {
                let sql = `SELECT * FROM customers WHERE company_id = $1`;
                const sqlParams = [actualCompanyId];
                if (!isAdmin) { sqlParams.push(effectiveEmail); sql += ` AND ${ownRecordCondition('customers', `$${sqlParams.length}`)}`; }
                if (f.city) { sqlParams.push(`%${f.city.toLowerCase()}%`); sql += ` AND LOWER(city) LIKE $${sqlParams.length}`; }
                if (f.state) { sqlParams.push(`%${f.state.toLowerCase()}%`); sql += ` AND LOWER(state) LIKE $${sqlParams.length}`; }
                sql += ` ORDER BY created_at DESC NULLS LAST LIMIT 200`;
                const custRes = await pool.query(sql, sqlParams);
                toolResult = { count: custRes.rows.length, filter_applied: f, customers: custRes.rows.map(r => ({ name: r.name, email: r.email, phone: r.phone, city: r.city, state: r.state })) };
                actionsExecuted.push({ tool_name: 'get_customers', result: `Found ${custRes.rows.length} customers` });
              } else {
                const ownCondition = !isAdmin ? ownRecordCondition(args.data_type, '$2') : null;
                const queryParams = isAdmin ? [actualCompanyId] : [actualCompanyId, effectiveEmail];
                const countRes = await pool.query(`SELECT COUNT(*) as count FROM ${table} WHERE company_id = $1${ownCondition ? ` AND ${ownCondition}` : ''}`, queryParams);
                const sampleRes = await pool.query(`SELECT * FROM ${table} WHERE company_id = $1${ownCondition ? ` AND ${ownCondition}` : ''} ORDER BY created_at DESC NULLS LAST LIMIT 10`, queryParams);
                const count = parseInt(countRes.rows[0].count);
                if (args.data_type === 'invoices') {
                  const invTotalRes = await pool.query(`SELECT COALESCE(SUM(total_amount),0) AS total FROM invoices WHERE company_id = $1 AND COALESCE(status,'') NOT IN ('cancelled','void')`, [actualCompanyId]);
                  const totalRevenue = Number(invTotalRes.rows[0].total);
                  toolResult = { count, total_revenue: totalRevenue, total_invoiced_all_time: totalRevenue, sample_is_partial: true, sample: sampleRes.rows.slice(0, 5).map(r => ({ number: r.invoice_number, amount: r.total_amount ?? r.amount, status: r.status })) };
                } else if (args.data_type === 'calendar_events') {
                  toolResult = { count, sample: sampleRes.rows.slice(0, 5).map(r => ({ title: r.title, start: r.start_time, type: r.event_type, status: r.status })) };
                } else if (args.data_type === 'tasks') {
                  toolResult = { count, sample: sampleRes.rows.slice(0, 5).map(r => ({ name: r.name, status: r.status, priority: r.priority, due: r.due_date })) };
                } else if (args.data_type === 'staff') {
                  toolResult = { count, staff: sampleRes.rows.map(r => ({ name: r.full_name, email: r.user_email, role: r.role_name })) };
                } else {
                  toolResult = { count };
                }
                actionsExecuted.push({ tool_name: `get_${args.data_type}`, result: `Found ${count} ${args.data_type}` });
              }
            }

          } else if (fname === 'create_calendar_event') {
            // Validate the date so an unparseable value returns a friendly message instead of
            // throwing inside the SQL INSERT. Insert the ORIGINAL string (not a UTC-coerced one)
            // so the stored wall-clock time is preserved — start_time is a TIMESTAMP (no tz).
            const buildRouteBlock = calendarBuildRouteGuard(args);
            const parsedStart = new Date(args.start_time);
            if (buildRouteBlock) {
              toolResult = buildRouteBlock;
            } else if (!args.start_time || isNaN(parsedStart.getTime())) {
              toolResult = { error: `I couldn't understand the date/time for "${args.title || 'the event'}". Please tell me a specific date and time (for example "tomorrow at 10am").` };
            } else {
              let endTime = args.end_time;
              if (!endTime) { const d = new Date(parsedStart.getTime() + 3600000); endTime = d.toISOString(); }
              const evId = crypto.randomUUID();
              const evBase44 = `cal_${Date.now()}`;
              const emailRem = args.email_reminder_minutes != null ? parseInt(args.email_reminder_minutes) : null;
              const smsRem = args.sms_reminder_minutes != null ? parseInt(args.sms_reminder_minutes) : null;
              const browserRem = args.browser_reminder_minutes != null ? parseInt(args.browser_reminder_minutes) : null;
              const evRes = await pool.query(
                `INSERT INTO calendar_events (id, base44_id, title, start_time, end_time, location, description, event_type, status, company_id, assigned_to, created_by, created_at,
                 send_email_notification, email_reminder_minutes, send_sms_notification, sms_reminder_minutes, send_browser_notification, browser_reminder_minutes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9, $10, $10, NOW(), $11, $12, $13, $14, $15, $16) RETURNING id`,
                [evId, evBase44, args.title, args.start_time, endTime, args.location || '', args.description || '', args.event_type || 'meeting', actualCompanyId, effectiveEmail,
                 emailRem != null, emailRem, smsRem != null, smsRem, browserRem != null, browserRem]
              );
              const calReminders = [];
              if (emailRem) calReminders.push(`email ${emailRem}min before`);
              if (smsRem) calReminders.push(`SMS ${smsRem}min before`);
              if (browserRem) calReminders.push(`browser ${browserRem}min before`);
              const calRemMsg = calReminders.length > 0 ? ` with reminders: ${calReminders.join(', ')}` : '';
              toolResult = { success: true, event_id: evRes.rows[0].id, message: `Event "${args.title}" created${calRemMsg}` };
              actionsExecuted.push({ tool_name: 'create_event', result: `Created: "${args.title}"` });
            }

          } else if (fname === 'create_task') {
            const taskRes = await pool.query(
              `INSERT INTO tasks (name, description, due_date, priority, status, company_id, assigned_to, created_at)
               VALUES ($1, $2, $3, $4, 'not_started', $5, $6, NOW()) RETURNING id`,
              [args.name, args.description || '', args.due_date || null, args.priority || 'medium', actualCompanyId, effectiveEmail]
            );
            toolResult = { success: true, task_id: taskRes.rows[0].id };
            actionsExecuted.push({ tool_name: 'create_task', result: `Created task: ${args.name}` });

          } else if (fname === 'route_lead_to_sequence') {
            const lead = await pool.query(`SELECT id, name FROM leads WHERE id = $1 AND company_id = $2 LIMIT 1`, [args.lead_id, actualCompanyId]);
            const workflow = await pool.query(`SELECT id FROM generic_entities WHERE entity_type = 'Workflow' AND company_id = $1 AND COALESCE(data->>'is_active','true') <> 'false' AND LOWER(COALESCE(data->>'workflow_name', data->>'name','')) = LOWER($2) LIMIT 1`, [actualCompanyId, args.sequence_name]);
            if (!lead.rowCount) toolResult = { success: false, error: 'That lead is not in this company.' };
            else if (!workflow.rowCount) toolResult = { success: false, error: 'I could not find an active company follow-up sequence with that name.' };
            else return { response: `I’m ready to enroll **${lead.rows[0].name}** in **${args.sequence_name}**. Shall I start that follow-up sequence?`, requires_confirmation: true, proposed_action: { type: 'lexi_sequence', lead_id: args.lead_id, workflow_id: workflow.rows[0].id, sequence_name: args.sequence_name }, actions_executed: actionsExecuted };

          } else if (fname === 'trigger_document_packet') {
            const table = args.recipient_type === 'lead' ? 'leads' : args.recipient_type === 'customer' ? 'customers' : null;
            if (!table) toolResult = { success: false, error: 'Choose a lead or customer for this packet.' };
            else {
              const recipient = await pool.query(`SELECT id, name, email, phone FROM ${table} WHERE id = $1 AND company_id = $2 LIMIT 1`, [args.recipient_id, actualCompanyId]);
              if (!recipient.rowCount) toolResult = { success: false, error: 'That recipient is not in this company.' };
              else if (args.channel === 'email' && !recipient.rows[0].email) toolResult = { success: false, error: 'That recipient has no email address.' };
              else if (args.channel === 'sms' && !recipient.rows[0].phone) toolResult = { success: false, error: 'That recipient has no phone number.' };
              else return { response: `I’m ready to send a restoration packet to **${recipient.rows[0].name}** by ${args.channel.toUpperCase()}. Shall I send it?`, requires_confirmation: true, proposed_action: { type: 'lexi_packet', ...args }, actions_executed: actionsExecuted };
            }

          } else if (fname === 'dispatch_team_notification') {
            const needle = String(args.assignee || '').trim().toLowerCase();
            const staff = await pool.query(`SELECT full_name, COALESCE(NULLIF(user_email,''), email) AS email FROM staff_profiles WHERE company_id = $1 AND is_active IS NOT FALSE AND (LOWER(COALESCE(user_email,'')) = $2 OR LOWER(COALESCE(email,'')) = $2 OR LOWER(COALESCE(full_name,'')) = $2) LIMIT 2`, [actualCompanyId, needle]);
            if (staff.rowCount !== 1) toolResult = { success: false, error: staff.rowCount ? 'More than one teammate matches that name; please use their email.' : 'That teammate is not an active member of this company.' };
            else {
              const taskId = crypto.randomUUID(), assignee = staff.rows[0];
              await pool.query(`INSERT INTO tasks (id,name,description,due_date,priority,status,company_id,assigned_to,created_at) VALUES ($1,$2,$3,$4,$5,'not_started',$6,$7,NOW())`, [taskId, args.title, args.context_note, args.due_date || null, args.priority || 'medium', actualCompanyId, assignee.email]);
              await pool.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'Notification',$2,$3,NOW(),NOW())`, [crypto.randomUUID(), actualCompanyId, JSON.stringify({ company_id: actualCompanyId, user_email: assignee.email, title: 'New operational ticket', message: `${args.title}: ${args.context_note}`, type: 'task_assigned', related_entity_type: 'Task', related_entity_id: taskId, link_url: '/Tasks', is_read: false })]);
              toolResult = { success: true, task_id: taskId, assignee: assignee.full_name, message: `Operational ticket assigned to ${assignee.full_name}.` };
              actionsExecuted.push({ tool_name: 'dispatch_team_notification', result: `Assigned ${args.title} to ${assignee.full_name}` });
            }

          } else if (fname === 'create_lead') {
            const leadId = crypto.randomUUID();
            const leadRes = await pool.query(
              `INSERT INTO leads (id, name, email, phone, street, city, state, zip, notes, status, lead_source, company_id, assigned_to, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', 'Lexi AI', $10, $11, NOW()) RETURNING id`,
              [leadId, args.name, args.email || '', args.phone || '', args.street || '', args.city || '', args.state || '', args.zip || '', args.notes || '', actualCompanyId, effectiveEmail]
            );
            if (args.phone) invalidateCallerCache(actualCompanyId, args.phone);
            toolResult = { success: true, lead_id: leadRes.rows[0].id, message: `Lead "${args.name}" created` };
            actionsExecuted.push({ tool_name: 'create_lead', result: `Created lead: ${args.name}` });

          } else if (fname === 'create_customer') {
            const custId = crypto.randomUUID();
            const custInsRes = await pool.query(
              `INSERT INTO customers (id, name, email, phone, street, city, state, zip, company_id, assigned_to, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) RETURNING id`,
              [custId, args.name, args.email || '', args.phone || '', args.street || '', args.city || '', args.state || '', args.zip || '', actualCompanyId, effectiveEmail]
            );
            if (args.phone) invalidateCallerCache(actualCompanyId, args.phone);
            toolResult = { success: true, customer_id: custInsRes.rows[0].id, message: `Customer "${args.name}" created` };
            actionsExecuted.push({ tool_name: 'create_customer', result: `Created customer: ${args.name}` });

          } else if (fname === 'send_email') {
            return { response: `I'd like to send an email:\n\n**To:** ${args.to}\n**Subject:** ${args.subject}\n\n${args.message}\n\nShall I send this?`, requires_confirmation: true, proposed_action: { type: 'email', ...args }, actions_executed: actionsExecuted };

          } else if (fname === 'send_sms') {
            return { response: `I'd like to send a text message:\n\n**To:** ${args.to}\n\n${args.message}\n\nShall I send this?`, requires_confirmation: true, proposed_action: { type: 'sms', ...args }, actions_executed: actionsExecuted };

          } else if (fname === 'get_calendar_events') {
            const startDate = args.start_date || todayISO;
            const endDate = args.end_date || startDate;
            const endDatePlusOne = new Date(endDate);
            endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);
            const eventsRes = await pool.query(
              `SELECT id, title, start_time, end_time, location, description, event_type, status, assigned_to
               FROM calendar_events WHERE company_id = $1 AND start_time >= $2 AND start_time < $3${isAdmin ? '' : ` AND ${ownRecordCondition('calendar_events', '$4')}`}
               ORDER BY start_time ASC LIMIT 50`,
              isAdmin ? [actualCompanyId, startDate, endDatePlusOne.toISOString().split('T')[0]] : [actualCompanyId, startDate, endDatePlusOne.toISOString().split('T')[0], effectiveEmail]
            );
            const events = eventsRes.rows.map(e => ({
              id: e.id, title: e.title,
              start: new Date(e.start_time).toLocaleString('en-US', { timeZone: userTimeZone }),
              end: e.end_time ? new Date(e.end_time).toLocaleString('en-US', { timeZone: userTimeZone }) : null,
              location: e.location, type: e.event_type, status: e.status, assigned_to: e.assigned_to
            }));
            toolResult = { count: events.length, events };
            actionsExecuted.push({ tool_name: 'get_calendar_events', result: `Found ${events.length} events` });

          } else if (fname === 'save_memory') {
            const memKey = String(args.key || '').trim();
            const memValue = String(args.value || '').trim();
            if (!memKey || !memValue) {
              toolResult = { error: 'Both key and value are required to save a memory.', success: false };
            } else {
              const memImportance = Math.min(10, Math.max(1, parseInt(args.importance, 10) || 5));
              // Personal memories only: never allow 'company' (would inject into every
              // user's sessions) or the calibration categories (different schema).
              let memCategory = String(args.category || 'lexi').trim().toLowerCase() || 'lexi';
              if (['company', 'estimator_calibration', 'job_calibration'].includes(memCategory)) memCategory = 'lexi';
              const memId = crypto.randomUUID();
              await pool.query(
                `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'AIMemory', $2, $3, NOW(), NOW())`,
                [memId, String(actualCompanyId), JSON.stringify({
                  company_id: String(actualCompanyId),
                  user_email: effectiveEmail,
                  key: memKey,
                  value: memValue,
                  importance: memImportance,
                  category: memCategory,
                  is_active: true,
                  created_by: effectiveEmail,
                  source: 'lexi_auto'
                })]
              );
              toolResult = { success: true, id: memId, message: `Preference saved — I'll remember "${memKey}".` };
              actionsExecuted.push({ tool_name: 'save_memory', result: `Saved memory: ${memKey}` });
            }
          } else if (fname === 'manage_entity') {
            const { entity_action, entity_data, entity_id } = args;
            if (!isAdmin) {
              toolResult = lexiAccessDenied('I can help with your assigned CRM records through the dedicated tools, but I can’t use unrestricted entity management.');
              pushGroundedToolResponse(fname, args, toolResult, fc);
              continue;
            }
            // Normalize entity_name to canonical SDK casing so DB writes match entity-API reads
            // (e.g. Gemini passes "subcontractor" → must store as "Subcontractor")
            const ENTITY_NAME_CANONICAL = { 'subcontractor': 'Subcontractor', 'subcontractors': 'Subcontractor', 'estimate': 'Estimate', 'invoice': 'Invoice', 'project': 'Project', 'customer': 'Customer', 'lead': 'Lead', 'task': 'Task', 'calendarevent': 'CalendarEvent', 'staffprofile': 'StaffProfile', 'payment': 'Payment', 'familymember': 'FamilyMember' };
            const entity_name = canonicalizeGenericEntityType(ENTITY_NAME_CANONICAL[(args.entity_name || '').toLowerCase().replace(/[_\s-]/g, '')] || args.entity_name);
            const entityTableMap = { 'Estimate': 'estimates', 'Invoice': 'invoices', 'Project': 'projects', 'Customer': 'customers', 'Lead': 'leads', 'Task': 'tasks', 'CalendarEvent': 'calendar_events', 'StaffProfile': 'staff_profiles', 'Payment': 'payments' };
            const directTable = entityTableMap[entity_name];
            const isStaffTarget = directTable === 'staff_profiles' || ['staff', 'staffprofile', 'staff_profile', 'staffprofiles'].includes(String(entity_name || '').toLowerCase());
            const isPaymentTarget = directTable === 'payments' || ['payment', 'payments'].includes(String(args.entity_name || '').toLowerCase());

            // A build must not reach the calendar through the generic CRUD tool either.
            const entityBuildRouteBlock = manageEntityBuildRouteGuard(entity_name, entity_action, entity_data);
            if (entityBuildRouteBlock) {
              toolResult = entityBuildRouteBlock;
            } else if (!isAdmin && entity_action === 'list') {
              toolResult = lexiAccessDenied('I can look up your assigned leads, customers, tasks, projects, calendar events, and estimates, but I can’t browse unrestricted company records.');
            } else if (isPaymentTarget && (entity_action === 'create' || entity_action === 'update')) {
              toolResult = { error: 'ERROR: You MUST use the record_payment tool for payments — NEVER manage_entity. Payments recorded via manage_entity are completely invisible to users. Call record_payment instead.' };
            } else if (isStaffTarget && entity_action !== 'list') {
              toolResult = { error: `I can't ${entity_action} staff records directly. Ask me to add a staff member (added without admin access); changing roles or admin access must be done by an administrator in Settings.` };
            } else if (entity_action === 'list') {
              if (directTable) {
                const listRes = await pool.query(`SELECT * FROM ${directTable} WHERE company_id = $1 ORDER BY created_at DESC NULLS LAST LIMIT 20`, [actualCompanyId]);
                toolResult = { count: listRes.rows.length, items: listRes.rows.slice(0, 10) };
              } else {
                const listRes = await pool.query(
                  `SELECT id, data FROM generic_entities WHERE entity_type = $1 AND (company_id = $2 OR (data->>'company_id') = $2) ORDER BY created_date DESC NULLS LAST LIMIT 20`,
                  [entity_name, String(actualCompanyId)]
                );
                toolResult = { count: listRes.rows.length, items: listRes.rows.map(r => ({ id: r.id, ...r.data })).slice(0, 10) };
              }
              actionsExecuted.push({ tool_name: 'list_entity', result: `Listed ${toolResult.count} ${entity_name}` });
            } else if (entity_action === 'create') {
              if (directTable) {
                const fields = { ...entity_data, company_id: actualCompanyId, created_at: new Date().toISOString() };
                const keys = Object.keys(fields);
                const vals = Object.values(fields);
                const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
                const createRes = await pool.query(`INSERT INTO ${directTable} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING id`, vals);
                if ((directTable === 'leads' || directTable === 'customers') && entity_data?.phone) {
                  invalidateCallerCache(actualCompanyId, entity_data.phone);
                }
                toolResult = { success: true, id: createRes.rows[0].id, message: `${entity_name} created` };
              } else {
                // generic_entities: must set top-level company_id column (frontend filters
                // by it) AND mirror it in data; use created_date/updated_date (actual
                // schema column names) and a generated string id like dev does.
                const genId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                // Expense: map LLM alias fields (vendor/date) → canonical schema + default
                // category, or the Expenses page crashes on undefined category
                const entData = normalizeGenericEntityData(entity_name, { ...entity_data, company_id: String(actualCompanyId) }, { applyDefaults: true });
                const createRes = await pool.query(
                  `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id`,
                  [genId, entity_name, String(actualCompanyId), JSON.stringify(entData)]
                );
                toolResult = { success: true, id: createRes.rows[0].id, message: `${entity_name} created` };
              }
              actionsExecuted.push({ tool_name: 'create_entity', result: `Created ${entity_name}` });
            } else if (entity_action === 'update' && entity_id) {
              if (directTable) {
                const keys = Object.keys(entity_data || {});
                // BEFORE snapshot, so a reschedule can be reported as
                // before → after instead of an unverified "done".
                const beforeRes = await pool.query(`SELECT * FROM ${directTable} WHERE id = $1 AND company_id = $2`, [parseInt(entity_id), actualCompanyId]);
                const beforeRow = beforeRes.rows[0] || null;
                if (keys.length > 0) {
                  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
                  await pool.query(`UPDATE ${directTable} SET ${setClauses} WHERE id = $${keys.length + 1} AND company_id = $${keys.length + 2}`, [...Object.values(entity_data), parseInt(entity_id), actualCompanyId]);
                }
                if (directTable === 'leads' || directTable === 'customers') {
                  invalidateCallerCacheForCompany(actualCompanyId);
                }
                const afterRes = await pool.query(`SELECT * FROM ${directTable} WHERE id = $1 AND company_id = $2`, [parseInt(entity_id), actualCompanyId]);
                toolResult = buildWriteVerificationResult({
                  label: `${entity_name} #${entity_id}`,
                  requested: entity_data || {},
                  before: beforeRow,
                  after: afterRes.rows[0] || null,
                });
              } else {
                // generic_entities ids are strings (e.g. "local_…"), not ints
                const existing = await pool.query(`SELECT data FROM generic_entities WHERE id = $1 AND entity_type = $2 AND company_id = $3`, [String(entity_id), entity_name, String(actualCompanyId)]);
                if (existing.rows.length > 0) {
                  if (entity_name === 'BuildSchedule' && isBuildSchedulingMutation(entity_data)) {
                    const proposed = { ...(existing.rows[0].data || {}), ...entity_data };
                    const confirmation = buildScheduleConfirmationGuard({
                      companyId: actualCompanyId, userEmail: effectiveUserEmail, action: 'update', recordId: entity_id,
                      customerId: proposed.customer_id, customerName: proposed.customer_name,
                      buildDate: proposed.build_date, jobTypes: proposed.job_type || proposed.job_types,
                    }, args.confirmation_token);
                    if (confirmation) {
                      toolResult = confirmation;
                      continue;
                    }
                  }
                  const merged = normalizeGenericEntityData(entity_name, { ...existing.rows[0].data, ...entity_data });
                  await pool.query(`UPDATE generic_entities SET data = $1, updated_date = NOW() WHERE id = $2 AND company_id = $3`, [JSON.stringify(merged), String(entity_id), String(actualCompanyId)]);
                  if (entity_name === 'BuildSchedule' && !merged.calendar_event_id) {
                    let calendarId = null;
                    try {
                      const day = buildDayRange(merged.build_date, userTimeZone);
                      calendarId = `cal_${String(entity_id)}`;
                      const jobTypes = Array.isArray(merged.job_type) ? merged.job_type : (merged.job_type ? [merged.job_type] : ['Build']);
                      const cal = await pool.query(`INSERT INTO calendar_events (id,title,start_time,end_time,event_type,company_id,assigned_to,created_by,location,description,status,created_at) VALUES ($1,$2,$3,$4,'build',$5,$6,$7,$8,$9,$10,NOW()) RETURNING id`, [calendarId, `${jobTypes.join(' & ')}: ${merged.customer_name || 'Build'}`, day.start_time, day.end_time, actualCompanyId, Array.isArray(merged.assigned_to) ? merged.assigned_to[0] : (merged.assigned_to || effectiveUserEmail), merged.created_by || effectiveUserEmail, merged.address || '', merged.notes || '', merged.status || 'scheduled']);
                      await pool.query(`UPDATE generic_entities SET data=data || $1, updated_date=NOW() WHERE id=$2 AND entity_type='BuildSchedule' AND company_id=$3`, [JSON.stringify({ calendar_event_id: cal.rows[0].id }), String(entity_id), String(actualCompanyId)]);
                      const verified = await pool.query(`SELECT ge.data->>'calendar_event_id' AS calendar_event_id, EXISTS(SELECT 1 FROM calendar_events WHERE id=$2 AND company_id=$3) AS event_exists FROM generic_entities ge WHERE ge.id=$1 AND ge.entity_type='BuildSchedule' AND ge.company_id=$3`, [String(entity_id), calendarId, String(actualCompanyId)]);
                      if (verified.rows[0]?.calendar_event_id !== calendarId || !verified.rows[0]?.event_exists) throw new Error('Saved build records could not be verified');
                    } catch (e) {
                      if (calendarId) await pool.query(`DELETE FROM calendar_events WHERE id=$1 AND company_id=$2`, [calendarId, actualCompanyId]).catch(() => {});
                      await pool.query(`UPDATE generic_entities SET data=$1, updated_date=NOW() WHERE id=$2 AND company_id=$3`, [JSON.stringify(existing.rows[0].data), String(entity_id), String(actualCompanyId)]);
                      toolResult = { success: false, error: `The build and calendar update could not be completed: ${e.message}` };
                      continue;
                    }
                  }
                  const reread = await pool.query(`SELECT data FROM generic_entities WHERE id = $1 AND entity_type = $2 AND company_id = $3`, [String(entity_id), entity_name, String(actualCompanyId)]);
                  toolResult = buildWriteVerificationResult({
                    label: `${entity_name} #${entity_id}`,
                    requested: entity_data || {},
                    before: existing.rows[0].data || {},
                    after: reread.rows[0]?.data || null,
                  });
                } else {
                  toolResult = { error: `${entity_name} #${entity_id} not found` };
                }
              }
              actionsExecuted.push({ tool_name: 'update_entity', result: `Updated ${entity_name} #${entity_id}` });
            } else if (entity_action === 'delete' && entity_id) {
              if (directTable) {
                await pool.query(`DELETE FROM ${directTable} WHERE id = $1 AND company_id = $2`, [parseInt(entity_id), actualCompanyId]);
                if (directTable === 'leads' || directTable === 'customers') {
                  invalidateCallerCacheForCompany(actualCompanyId);
                }
              } else {
                await pool.query(`DELETE FROM generic_entities WHERE id = $1 AND entity_type = $2`, [String(entity_id), entity_name]);
              }
              toolResult = { success: true, message: `${entity_name} #${entity_id} deleted` };
              actionsExecuted.push({ tool_name: 'delete_entity', result: `Deleted ${entity_name} #${entity_id}` });
            }

          } else if (fname === 'assign_inspection') {
            const inspDate = args.inspection_date || todayISO;
            const inspTime = args.inspection_time || '10:00';
            const startTime = `${inspDate}T${inspTime}:00`;
            const endDt = new Date(startTime);
            endDt.setHours(endDt.getHours() + 1);
            const endTime = endDt.toISOString();
            const inspData = { client_name: args.client_name, client_phone: args.client_phone || '', client_email: args.client_email || '', property_address: args.property_address, assigned_to: args.assigned_to_email, inspection_date: inspDate, inspection_time: inspTime, damage_type: args.damage_type || '', special_instructions: args.special_instructions || '', status: 'scheduled', company_id: String(actualCompanyId) };
            const inspRes = await pool.query(`INSERT INTO generic_entities (entity_type, data, created_at, updated_at) VALUES ('Inspection', $1, NOW(), NOW()) RETURNING id`, [JSON.stringify(inspData)]);
            toolResult = { success: true, inspection_id: inspRes.rows[0].id, message: `Inspection scheduled for ${args.client_name} at ${args.property_address}` };
            actionsExecuted.push({ tool_name: 'assign_inspection', result: `Inspection scheduled: ${args.client_name}` });
            if (args.create_calendar_event !== false) {
              try { 
                const inspEvId = crypto.randomUUID();
                const inspEvBase44 = `cal_${Date.now()}`;
                await pool.query(`INSERT INTO calendar_events (id, base44_id, title, start_time, end_time, location, description, event_type, status, company_id, assigned_to, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'inspection', 'scheduled', $8, $9, $9, NOW())`, [inspEvId, inspEvBase44, `Inspection: ${args.client_name}`, startTime, endTime, args.property_address, args.special_instructions || `Roof inspection for ${args.client_name}`, actualCompanyId, args.assigned_to_email]); 
                toolResult.calendar_event_created = true; 
              } catch (e) {}
            }
            if (args.create_lead !== false) {
              try { 
                const inspectionLeadId = crypto.randomUUID();
                await pool.query(`INSERT INTO leads (id, name, email, phone, street, notes, status, lead_source, company_id, assigned_to, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'new', 'Inspection', $7, $8, NOW())`, [inspectionLeadId, args.client_name, args.client_email || '', args.client_phone || '', args.property_address, args.special_instructions || '', actualCompanyId, args.assigned_to_email]); 
                if (args.client_phone) invalidateCallerCache(actualCompanyId, args.client_phone);
                toolResult.lead_created = true; 
              } catch (e) {}
            }
          } else if (fname === 'get_storm_alerts') {
            const daysBack = Math.max(1, Math.min(365, parseInt(args.days_back) || 30));
            const activeOnly = args.active_only || false;
            const areaFilter = args.area_filter ? args.area_filter.toLowerCase() : null;
            const eventTypes = args.event_types ? args.event_types.split(',').map(t => t.trim().toLowerCase()) : null;
            let stateFilter = null;
            try {
              const settingsRes = await pool.query(`SELECT data FROM generic_entities WHERE entity_type = 'StormAlertSettings' AND (company_id = $1 OR (data->>'company_id') = $1) ORDER BY updated_date DESC NULLS LAST LIMIT 1`, [String(actualCompanyId)]);
              if (settingsRes.rows.length > 0) {
                const s = settingsRes.rows[0].data || {};
                if (s.service_states && s.service_states.length > 0) stateFilter = s.service_states;
                else if (s.service_center_location) { const m = s.service_center_location.match(/,\s*([A-Z]{2})(?:\s|$)/); if (m) stateFilter = [m[1]]; }
              }
            } catch (e) {}
            if (!stateFilter) {
              try { const compRes = await pool.query(`SELECT data FROM companies WHERE id = $1`, [actualCompanyId]); if (compRes.rows.length > 0 && compRes.rows[0].data) { const cd = typeof compRes.rows[0].data === 'string' ? JSON.parse(compRes.rows[0].data) : compRes.rows[0].data; if (cd.state) stateFilter = [cd.state]; } } catch (e) {}
            }
            if (!stateFilter) {
              try { const custStates = await pool.query(`SELECT DISTINCT state FROM customers WHERE company_id = $1 AND state IS NOT NULL AND state != '' LIMIT 5`, [actualCompanyId]); if (custStates.rows.length > 0) stateFilter = custStates.rows.map(r => r.state.toUpperCase()); } catch (e) {}
            }
            const stormParams = [daysBack];
            let stormQuery = `SELECT id, data FROM generic_entities WHERE entity_type = 'StormEvent' AND (data->>'start_time')::timestamp >= NOW() - ($1::int * INTERVAL '1 day')`;
            if (stateFilter && stateFilter.length > 0) { stormParams.push(stateFilter); stormQuery += ` AND data->>'nws_state' = ANY($${stormParams.length})`; }
            if (activeOnly) stormQuery += ` AND data->>'status' = 'active'`;
            stormQuery += ` ORDER BY (data->>'start_time')::timestamp DESC LIMIT 50`;
            const stormRes = await pool.query(stormQuery, stormParams);
            let storms = stormRes.rows.map(r => ({ id: r.id, title: r.data.title, event_type: r.data.event_type, start_time: r.data.start_time, severity: r.data.severity, status: r.data.status, affected_areas: r.data.affected_areas, nws_state: r.data.nws_state }));
            if (eventTypes) storms = storms.filter(s => eventTypes.some(et => (s.event_type || '').toLowerCase().includes(et)));
            if (areaFilter) storms = storms.filter(s => { const areas = Array.isArray(s.affected_areas) ? s.affected_areas.join(' ').toLowerCase() : ''; return areas.includes(areaFilter) || (s.title || '').toLowerCase().includes(areaFilter); });
            const activeCount = storms.filter(s => s.status === 'active').length;
            const typeCounts = {}; storms.forEach(s => { const t = s.event_type || 'unknown'; typeCounts[t] = (typeCounts[t] || 0) + 1; });
            const stateLabel = stateFilter ? stateFilter.join(', ') : 'your area';
            toolResult = { total_count: storms.length, active_count: activeCount, type_breakdown: typeCounts, storms: storms.slice(0, 15), area_searched: stateLabel };
            actionsExecuted.push({ tool_name: 'get_storm_alerts', result: `Found ${storms.length} storm events in ${stateLabel}` });

          } else if (fname === 'find_subcontractors') {
            const subsRes = await pool.query(`SELECT id, data FROM generic_entities WHERE entity_type = 'Subcontractor' AND (company_id = $1 OR (data->>'company_id') = $1) ORDER BY created_date DESC NULLS LAST LIMIT 100`, [String(actualCompanyId)]);
            const allSubs = subsRes.rows.map(r => ({ id: r.id, ...r.data }));
            let matched = allSubs;
            if (args.area && args.area.trim()) { const kw = args.area.trim().toLowerCase(); matched = matched.filter(sub => [sub.base_address, sub.city, sub.state, sub.zip, sub.notes, sub.name].filter(Boolean).join(' ').toLowerCase().includes(kw)); }
            if (args.specialty && args.specialty.trim()) { const spec = args.specialty.trim().toLowerCase(); matched = matched.filter(sub => { const specs = Array.isArray(sub.specialty) ? sub.specialty : [sub.specialty || '']; return specs.some(s => (s || '').toLowerCase().includes(spec)); }); }
            matched.sort((a, b) => Number(b.is_active !== false) - Number(a.is_active !== false) || (Number(b.rating) || 0) - (Number(a.rating) || 0) || (Number(b.total_jobs_completed) || 0) - (Number(a.total_jobs_completed) || 0));
            const summary = matched.map(sub => ({ id: sub.id, name: sub.name, contact: sub.contact_person || '', phone: sub.phone || '', base_address: sub.base_address || '', rating: Number(sub.rating) || 0, rating_count: Number(sub.rating_count) || 0, service_radius_miles: Number(sub.service_radius_miles ?? sub.service_radius) || 0, specialty: Array.isArray(sub.specialty) ? sub.specialty.join(', ') : (sub.specialty || ''), availability: sub.availability || '', total_jobs_completed: Number(sub.total_jobs_completed) || 0, is_active: sub.is_active !== false }));
            toolResult = { total_in_company: allSubs.length, matched_count: matched.length, filter: { area: args.area || null, specialty: args.specialty || null }, subcontractors: summary, recommended_teams: summary.filter(sub => sub.is_active).slice(0, 3), recommendation_basis: 'Active crews are ranked by rating, then completed jobs. Compare work radius with the job location and call get_build_schedule for the requested date before confirming availability.' };
            actionsExecuted.push({ tool_name: 'find_subcontractors', result: `Found ${matched.length} subcontractors` });

          } else if (fname === 'add_staff_member') {
            const staffId = crypto.randomUUID();
            const staffInsRes = await pool.query(`INSERT INTO staff_profiles (id, company_id, full_name, name, user_email, email, phone, role, position, is_administrator, is_super_admin, is_active, created_at, updated_at, created_by) VALUES ($1, $2, $3, $3, $4, $4, $5, $6, $6, false, false, true, NOW(), NOW(), $7) RETURNING id`, [staffId, actualCompanyId, args.full_name, args.email, args.phone || '', args.role || 'Team Member', effectiveEmail]);
            toolResult = { success: true, staff_id: staffInsRes.rows[0].id, message: `Staff member "${args.full_name}" added as ${args.role || 'Team Member'}. They were added without admin access — an admin can grant that in Settings.` };
            actionsExecuted.push({ tool_name: 'add_staff_member', result: `Added staff: ${args.full_name}` });

          } else if (fname === 'get_activity_log') {
            if (!isAdmin) {
              toolResult = lexiAccessDenied('I can help with activity on your assigned work, but I can’t provide the company-wide activity log.');
              pushGroundedToolResponse(fname, args, toolResult, fc);
              continue;
            }
            const limit = Math.max(1, Math.min(args.limit || 20, 50));
            const moduleFilter = (args.module && args.module !== 'all') ? args.module : null;
            const events = [];
            const moduleTableMap = {
              leads: { table: 'leads', module: 'Leads', action: 'Lead Added', descFn: r => `New lead: ${r.name || 'Unknown'} (${r.status || 'New'})${r.lead_source ? ' via ' + r.lead_source : ''}` },
              communications: { table: 'generic_entities', entityType: 'Communication', module: 'Communications', action: 'Message', descFn: r => `${(r.type || 'message').toUpperCase()} ${r.direction || ''} ${r.direction === 'inbound' ? 'from' : 'to'} ${r.contact_name || r.to_number || 'Unknown'}${r.body ? ': ' + String(r.body).slice(0, 80) : ''}` },
              estimates: { table: 'generic_entities', entityType: 'Estimate', module: 'Sales', action: 'Estimate Created', descFn: r => `Estimate for ${r.customer_name || 'Unknown'} — ${r.status || 'Draft'}${r.total ? ', $' + Number(r.total).toLocaleString() : ''}` },
              invoices: { table: 'invoices', module: 'Billing', action: 'Invoice Created', descFn: r => `Invoice for ${r.customer_name || 'Unknown'} — $${Number(r.amount || 0).toLocaleString()} (${r.status || 'Draft'})` },
              tasks: { table: 'tasks', module: 'Tasks', action: 'Task Created', descFn: r => `Task: "${r.name || 'Untitled'}" — ${r.status || 'Open'}${r.assigned_to ? ', assigned to ' + r.assigned_to : ''}` },
              customers: { table: 'customers', module: 'Customers', action: 'Customer Added', descFn: r => `New customer: ${r.name || 'Unknown'}${r.email ? ' (' + r.email + ')' : ''}` },
              workflow: { table: 'generic_entities', entityType: 'WorkflowExecution', module: 'Automation', action: 'Workflow Executed', descFn: r => `Workflow "${r.workflow_name || 'Unknown'}" ran — ${r.status || 'completed'}` },
            };
            const modulesToQuery = moduleFilter ? [moduleFilter] : Object.keys(moduleTableMap);
            for (const mod of modulesToQuery) {
              const cfg = moduleTableMap[mod];
              if (!cfg) continue;
              try {
                let rows = [];
                if (cfg.entityType) {
                  const res = await pool.query(`SELECT data, created_date FROM generic_entities WHERE entity_type = $1 AND (company_id = $2 OR (data->>'company_id') = $2) ORDER BY created_date DESC NULLS LAST LIMIT 30`, [cfg.entityType, String(actualCompanyId)]);
                  rows = res.rows.map(r => ({ ...r.data, _created_at: r.created_date }));
                } else {
                  const res = await pool.query(`SELECT * FROM ${cfg.table} WHERE company_id = $1 ORDER BY created_at DESC NULLS LAST LIMIT 30`, [actualCompanyId]);
                  rows = res.rows;
                }
                for (const r of rows) {
                  const ts = r.created_date || r._created_at || r.created_at;
                  if (!ts) continue;
                  events.push({ timestamp: ts instanceof Date ? ts.toISOString() : String(ts), module: cfg.module, action: cfg.action, description: cfg.descFn(r), actor: r.created_by || (mod === 'workflow' ? 'System' : undefined) });
                }
              } catch (e) {}
            }
            events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            if (args.days && args.days > 0) { const cutoff = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000); events.splice(0, events.length, ...events.filter(e => new Date(e.timestamp) >= cutoff)); }
            const sliced = events.slice(0, limit);
            const byModule = {}; for (const e of sliced) byModule[e.module] = (byModule[e.module] || 0) + 1;
            toolResult = { count: sliced.length, summary_by_module: byModule, events: sliced };
            actionsExecuted.push({ tool_name: 'get_activity_log', result: `Retrieved ${sliced.length} events` });

          } else if (fname === 'get_financial_summary') {
            if (!isAdmin) {
              toolResult = lexiAccessDenied('I can show your own sales, but I can’t share company-wide financial totals.');
              pushGroundedToolResponse(fname, args, toolResult, fc);
              continue;
            }
            const period = (args.period || 'this_month').toString().toLowerCase();
            const timezone = userTimeZone || 'America/New_York';
            const zonedDate = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
            const addDays = (date, days) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
            const today = zonedDate(new Date());
            const [year, month] = today.split('-').map(Number);
            const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
            let startDay, endDay = addDays(today, 1);
            if (period === 'this_week') startDay = addDays(today, -(weekday === 0 ? 6 : weekday - 1));
            else if (period === 'last_month') {
              const firstThisMonth = new Date(`${year}-${String(month).padStart(2, '0')}-01T12:00:00Z`);
              firstThisMonth.setUTCMonth(firstThisMonth.getUTCMonth() - 1);
              startDay = firstThisMonth.toISOString().slice(0, 10);
              endDay = `${year}-${String(month).padStart(2, '0')}-01`;
            }
            else if (period === 'this_year') startDay = `${year}-01-01`;
            else if (period === 'last_7_days') startDay = addDays(today, -6);
            else if (period === 'last_30_days') startDay = addDays(today, -29);
            else if (period === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(args.start_date || '')) { startDay = args.start_date; endDay = /^\d{4}-\d{2}-\d{2}$/.test(args.end_date || '') ? addDays(args.end_date, 1) : endDay; }
            else startDay = `${year}-${String(month).padStart(2, '0')}-01`;
            try {
              const [fsPayRes, fsInvRes] = await Promise.all([
                pool.query(`SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM payments WHERE company_id=$1 AND COALESCE(payment_date, created_at)>=$2::date AND COALESCE(payment_date, created_at)<$3::date AND COALESCE(status,'received') IN ('received','paid','completed') AND COALESCE(data->>'is_withheld_offset', data->'data'->>'is_withheld_offset', 'false') NOT IN ('true','t','1')`, [actualCompanyId, startDay, endDay]),
                pool.query(`SELECT status, COUNT(*) as count, COALESCE(SUM(total_amount),0) as total FROM invoices WHERE company_id=$1 AND created_at>=$2::date AND created_at<$3::date AND COALESCE(status,'') NOT IN ('cancelled','void') GROUP BY status ORDER BY total DESC`, [actualCompanyId, startDay, endDay])
              ]);
              const fsTotalCollected = Number(fsPayRes.rows[0].total);
              const fsTotalInvoiced = fsInvRes.rows.reduce((s,r) => s + Number(r.total), 0);
              const fsInvoiceCount = fsInvRes.rows.reduce((s,r) => s + Number(r.count), 0);
              const fsBreakdown = fsInvRes.rows.map(r => ({ status: r.status || 'unknown', count: Number(r.count), total: Number(r.total) }));
              const fsFmt = n => '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
              toolResult = { success: true, period, reporting_timezone: timezone, period_range: { start: startDay, end_exclusive: endDay }, cash_received: fsTotalCollected, total_collected: fsTotalCollected, invoices_issued: fsTotalInvoiced, total_invoiced: fsTotalInvoiced, invoice_count: fsInvoiceCount, payment_count: Number(fsPayRes.rows[0].count), invoice_breakdown_by_status: fsBreakdown, summary: `Cash received for ${period.replace(/_/g,' ')}: ${fsFmt(fsTotalCollected)} across ${fsPayRes.rows[0].count} received payment(s). Separately, ${fsInvoiceCount} invoice(s) issued totaled ${fsFmt(fsTotalInvoiced)}.` };
            } catch(e) { toolResult = { error: `Could not retrieve financial summary: ${e.message}` }; }
            actionsExecuted.push({ tool_name: 'get_financial_summary', result: `Financial summary for ${period}` });

          } else if (fname === 'get_staff_sales_summary') {
            const requestedStaffName = (args.staff_name || args.rep_name || args.name || '').toString().trim();
            if (!isAdmin && (!requestedStaffName || ['all', 'team', 'everyone', 'all staff', 'all reps', 'whole team', 'the team', 'the whole team'].includes(requestedStaffName.toLowerCase()))) args.staff_name = effectiveEmail;
            const rawStaffName = (args.staff_name || args.rep_name || args.name || '').toString().trim();
            const ssTeamKeywords = ['all', 'team', 'everyone', 'all staff', 'all reps', 'whole team', 'the team', 'the whole team'];
            const isTeamQuery = !rawStaffName || ssTeamKeywords.includes(rawStaffName.toLowerCase());
            try {
              const period = (args.period || 'this_month').toString().toLowerCase();
              const nowSs = new Date();
              let startDate, endDate = new Date();
              if (period === 'this_week') { const dow = nowSs.getDay(); const back = dow === 0 ? 6 : dow - 1; startDate = new Date(nowSs.getFullYear(), nowSs.getMonth(), nowSs.getDate() - back); }
              else if (period === 'last_month') { startDate = new Date(nowSs.getFullYear(), nowSs.getMonth() - 1, 1); endDate = new Date(nowSs.getFullYear(), nowSs.getMonth(), 0, 23, 59, 59, 999); }
              else if (period === 'this_year') { startDate = new Date(nowSs.getFullYear(), 0, 1); }
              else if (period === 'last_7_days') { startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); }
              else if (period === 'last_30_days') { startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); }
              else if (period === 'all_time') { startDate = new Date(0); }
              else if (period === 'custom' && args.start_date) { startDate = new Date(args.start_date); if (args.end_date) endDate = new Date(args.end_date); }
              else { startDate = new Date(nowSs.getFullYear(), nowSs.getMonth(), 1); }
              if (!startDate || isNaN(startDate.getTime())) startDate = new Date(nowSs.getFullYear(), nowSs.getMonth(), 1);
              const ssFmt = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              const ssInvRes = await pool.query(
                `SELECT total_amount, sale_agent, created_by, issue_date, created_at, commission_splits FROM invoices WHERE company_id = $1 AND status = 'paid'`,
                [actualCompanyId]
              );
              if (isTeamQuery) {
                const allStaffRes = await pool.query(
                  `SELECT user_email, full_name FROM staff_profiles WHERE company_id = $1 AND is_active IS NOT FALSE AND user_email IS NOT NULL ORDER BY full_name`,
                  [actualCompanyId]
                );
                const salesMap = {}, countMap = {};
                for (const s of allStaffRes.rows) { salesMap[s.user_email] = 0; countMap[s.user_email] = 0; }
                for (const inv of ssInvRes.rows) {
                  const dRaw = inv.issue_date || inv.created_at;
                  const d = new Date(dRaw);
                  if (!dRaw || isNaN(d.getTime()) || d < startDate || d > endDate) continue;
                  const invTotal = Number(inv.total_amount || 0);
                  const splits = Array.isArray(inv.commission_splits) ? inv.commission_splits : [];
                  if (splits.length > 0) {
                    for (const sp of splits) {
                      if (sp && sp.user_email && sp.user_email in salesMap) {
                        salesMap[sp.user_email] += invTotal * (Number(sp.split_percentage || 0) / 100);
                        countMap[sp.user_email]++;
                      }
                    }
                  } else {
                    const email = inv.sale_agent || inv.created_by;
                    if (email && email in salesMap) { salesMap[email] += invTotal; countMap[email]++; }
                  }
                }
                const ranked = allStaffRes.rows
                  .map(s => ({ name: s.full_name, total_sales: salesMap[s.user_email] || 0, invoice_count: countMap[s.user_email] || 0 }))
                  .sort((a, b) => b.total_sales - a.total_sales)
                  .map((s, i) => ({ rank: i + 1, ...s }));
                const lines = ranked.map(s => `${s.rank}. ${s.name}: ${ssFmt(s.total_sales)} (${s.invoice_count} invoice${s.invoice_count === 1 ? '' : 's'})`);
                toolResult = {
                  success: true,
                  period,
                  period_range: { start: startDate.toISOString().split('T')[0], end: endDate.toISOString().split('T')[0] },
                  leaderboard: ranked,
                  total_reps: ranked.length,
                  summary: ranked.length > 0 ? `Sales leaderboard for ${period.replace(/_/g, ' ')}:\n${lines.join('\n')}` : `No sales recorded for ${period.replace(/_/g, ' ')}.`
                };
              } else {
                const escSs = rawStaffName.replace(/[\\%_]/g, '\\$&');
                const staffRes = await pool.query(
                  `SELECT user_email, full_name FROM staff_profiles WHERE company_id = $1 AND is_active IS NOT FALSE AND user_email IS NOT NULL AND (LOWER(user_email) = LOWER($2) OR LOWER(full_name) = LOWER($2) OR full_name ILIKE $3)`,
                  [actualCompanyId, rawStaffName, `%${escSs}%`]
                );
                const ssRows = staffRes.rows || [];
                const ssExact = ssRows.filter(r => (r.full_name || '').toLowerCase() === rawStaffName.toLowerCase());
                const ssPick = ssExact.length ? ssExact : ssRows;
                if (ssPick.length === 0) {
                  toolResult = { error: `I couldn't find a team member named "${rawStaffName}". Please check the name or pick someone from your staff list.` };
                } else if (ssPick.length > 1) {
                  const names = ssPick.slice(0, 5).map(r => r.full_name).join(', ');
                  toolResult = { error: `More than one team member matches "${rawStaffName}": ${names}. Which one did you mean?` };
                } else {
                  const staffMember = ssPick[0];
                  if (!isAdmin && String(staffMember.user_email || '').toLowerCase() !== String(effectiveEmail || '').toLowerCase()) {
                    toolResult = lexiAccessDenied('I can show your own sales, but I can’t share another team member’s sales or earnings.');
                    pushGroundedToolResponse(fname, args, toolResult, fc);
                    continue;
                  }
                  const ssEmail = staffMember.user_email;
                  let totalSales = 0, invoiceCount = 0;
                  for (const inv of ssInvRes.rows) {
                    const dRaw = inv.issue_date || inv.created_at;
                    const d = new Date(dRaw);
                    if (!dRaw || isNaN(d.getTime()) || d < startDate || d > endDate) continue;
                    const invTotal = Number(inv.total_amount || 0);
                    const splits = Array.isArray(inv.commission_splits) ? inv.commission_splits : [];
                    const mySplit = splits.find(s => s && s.user_email === ssEmail);
                    if (mySplit) {
                      totalSales += invTotal * (Number(mySplit.split_percentage || 0) / 100);
                      invoiceCount++;
                    } else if (splits.length === 0 && (inv.sale_agent === ssEmail || inv.created_by === ssEmail)) {
                      totalSales += invTotal;
                      invoiceCount++;
                    }
                  }
                  toolResult = {
                    success: true,
                    staff_name: staffMember.full_name,
                    period,
                    period_range: { start: startDate.toISOString().split('T')[0], end: endDate.toISOString().split('T')[0] },
                    total_sales: totalSales,
                    invoice_count: invoiceCount,
                    summary: `${staffMember.full_name} brought in ${ssFmt(totalSales)} in sales across ${invoiceCount} paid invoice${invoiceCount === 1 ? '' : 's'} for ${period.replace(/_/g, ' ')}.`
                  };
                }
              }
            } catch (e) {
              toolResult = { error: `Could not calculate sales${rawStaffName ? ` for ${rawStaffName}` : ''}: ${e.message}` };
            }
            actionsExecuted.push({ tool_name: 'get_staff_sales_summary', result: isTeamQuery ? 'Team sales leaderboard' : `Sales summary for ${rawStaffName}` });

          } else if (fname === 'add_note') {
            const noteText = (args.note_text || args.text || args.content || args.body || args.note || '').toString().trim();
            if (!noteText) { toolResult = { error: 'note_text is required' }; }
            else {
              let customerId = args.customer_id || null;
              let leadId = args.lead_id || null;
              let parentLabel = '';
              if (customerId) {
                const own = await pool.query(`SELECT name FROM customers WHERE id::text = $1 AND company_id = $2 LIMIT 1`, [String(customerId), actualCompanyId]);
                if (own.rows.length === 0) { toolResult = { error: `Customer ${customerId} not found in your company.` }; }
                else { parentLabel = `customer "${own.rows[0].name}"`; }
              }
              if (!toolResult.error && leadId) {
                const own = await pool.query(`SELECT name FROM leads WHERE id::text = $1 AND company_id = $2 LIMIT 1`, [String(leadId), actualCompanyId]);
                if (own.rows.length === 0) { toolResult = { error: `Lead ${leadId} not found in your company.` }; }
                else { parentLabel = `lead "${own.rows[0].name}"`; }
              }
              if (!customerId && args.customer_name) {
                const cn = args.customer_name.trim().toLowerCase();
                const cMatch = await pool.query(`SELECT id, name FROM customers WHERE company_id = $1 AND LOWER(name) LIKE $2 ORDER BY (LOWER(name) = $3) DESC, created_at DESC LIMIT 5`, [actualCompanyId, `%${cn}%`, cn]);
                if (cMatch.rows.length === 0) { toolResult = { error: `No customer found matching "${args.customer_name}". Ask the user for the exact name or provide a lead instead.` }; }
                else if (cMatch.rows.length > 1 && cMatch.rows[0].name.toLowerCase() !== cn) { toolResult = { error: `Multiple customers match "${args.customer_name}": ${cMatch.rows.map(r => r.name).join(', ')}. Ask which one.`, candidates: cMatch.rows }; }
                else { customerId = cMatch.rows[0].id; parentLabel = `customer "${cMatch.rows[0].name}"`; }
              }
              if (!toolResult.error && !customerId && !leadId && args.lead_name) {
                const ln = args.lead_name.trim().toLowerCase();
                const lMatch = await pool.query(`SELECT id, name FROM leads WHERE company_id = $1 AND LOWER(name) LIKE $2 ORDER BY (LOWER(name) = $3) DESC, created_at DESC LIMIT 5`, [actualCompanyId, `%${ln}%`, ln]);
                if (lMatch.rows.length === 0) { toolResult = { error: `No lead found matching "${args.lead_name}". Ask the user for the exact name or provide a customer instead.` }; }
                else if (lMatch.rows.length > 1 && lMatch.rows[0].name.toLowerCase() !== ln) { toolResult = { error: `Multiple leads match "${args.lead_name}": ${lMatch.rows.map(r => r.name).join(', ')}. Ask which one.`, candidates: lMatch.rows }; }
                else { leadId = lMatch.rows[0].id; parentLabel = `lead "${lMatch.rows[0].name}"`; }
              }
              if (!toolResult.error && !customerId && !leadId) { toolResult = { error: 'No customer or lead specified. Ask the user which customer or lead this note is for.' }; }
              if (!toolResult.error && (customerId || leadId)) {
                let createdByName = null;
                try { const spRes = await pool.query(`SELECT full_name FROM staff_profiles WHERE user_email = $1 LIMIT 1`, [effectiveEmail]); if (spRes.rows.length > 0) createdByName = spRes.rows[0].full_name || null; } catch (e) {}
                const noteId = crypto.randomUUID();
                const noteData = { note: noteText, created_at: new Date().toISOString(), created_by: effectiveEmail, created_by_name: createdByName, source_type: 'lexi', source_label: 'Lexi' };
                if (customerId) noteData.customer_id = customerId;
                if (leadId) noteData.lead_id = leadId;
                await pool.query(`INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'CustomerNote', $2, $3, NOW(), NOW())`, [noteId, String(actualCompanyId), JSON.stringify(noteData)]);
                toolResult = { success: true, note_id: noteId, message: `Note added to ${parentLabel || 'record'}.` };
                actionsExecuted.push({ tool_name: 'add_note', result: `Note added to ${parentLabel || 'record'}` });
              }
            }
          } else if (fname === 'get_photosync_jobs') {
            const psStatus = args.status || 'all';
            const psLimit = Math.min(args.limit || 10, 50);
            const psDaysBack = args.days_back;
            const psWhere = [`entity_type = 'InspectionJob'`, `company_id = $1`];
            const psParams = [actualCompanyId];
            if (psStatus && psStatus !== 'all') { psParams.push(psStatus); psWhere.push(`data->>'status' = $${psParams.length}`); }
            if (psDaysBack) psWhere.push(`created_date >= NOW() - INTERVAL '${parseInt(psDaysBack)} days'`);
            const psRes = await pool.query(`SELECT id, data, created_date FROM generic_entities WHERE ${psWhere.join(' AND ')} ORDER BY created_date DESC LIMIT ${psLimit}`, psParams);
            const psJobs = psRes.rows.map(r => ({ id: r.id, client: r.data.client_name || r.data.customer_name, client_phone: r.data.client_phone, client_email: r.data.client_email, address: r.data.property_address, status: r.data.status || 'scheduled', priority: r.data.priority, assigned_to: r.data.assigned_to_email, date: r.data.inspection_date || r.data.scheduled_date, time: r.data.inspection_time, damage_type: r.data.damage_type, notes: r.data.notes || null, special_instructions: r.data.special_instructions || null, created: r.created_date }));
            toolResult = { jobs: psJobs, total: psJobs.length };
            actionsExecuted.push({ tool_name: 'get_photosync_jobs', result: `Found ${psJobs.length} PhotoSync jobs` });

          } else if (fname === 'add_family_commission_member') {
            const famId = crypto.randomUUID();
            const famMemberData = { full_name: args.full_name, email: args.email, phone: args.phone || '', commission_percentage: args.commission_percentage || 1, notes: args.notes || '', is_active: true, company_id: String(actualCompanyId) };
            const famRes = await pool.query(`INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'FamilyMember', $2, $3, NOW(), NOW()) RETURNING id`, [famId, String(actualCompanyId), famMemberData]);
            toolResult = { success: true, member_id: famRes.rows[0].id, message: `"${args.full_name}" has been added as a Family Commission Member with ${args.commission_percentage || 1}% commission. They will now appear in the Family Commissions page.` };
            actionsExecuted.push({ tool_name: 'add_family_commission_member', result: `Added family commission member: ${args.full_name}` });
          } else if (fname === 'scan_check') {
            const { file_url: scUrl, customer_name: scCustName, customer_id: scCustId } = args;
            if (!scUrl) {
              toolResult = { error: 'file_url is required. Make sure the check image was uploaded before calling this tool.' };
            } else {
              let scCustomerId = scCustId || null;
              let scCustomerName = '';
              if (scCustomerId) {
                const scCR = await pool.query(`SELECT id, name FROM customers WHERE id::text = $1 AND company_id = $2 LIMIT 1`, [String(scCustomerId), actualCompanyId]);
                if (scCR.rows.length > 0) { scCustomerName = scCR.rows[0].name; }
                else { toolResult = { error: `Customer "${scCustomerId}" not found.` }; }
              } else if (scCustName) {
                const scCn = scCustName.trim().toLowerCase();
                const scCR = await pool.query(`SELECT id, name FROM customers WHERE company_id = $1 AND LOWER(name) LIKE $2 ORDER BY (LOWER(name) = $3) DESC, created_at DESC LIMIT 5`, [actualCompanyId, `%${scCn}%`, scCn]);
                if (scCR.rows.length === 0) { toolResult = { error: `No customer found matching "${scCustName}". Ask the user which customer this check is for.` }; }
                else if (scCR.rows.length > 1 && scCR.rows[0].name.toLowerCase() !== scCn) { toolResult = { error: `Multiple customers match "${scCustName}": ${scCR.rows.map(r => r.name).join(', ')}. Ask which one.`, candidates: scCR.rows }; }
                else { scCustomerId = scCR.rows[0].id; scCustomerName = scCR.rows[0].name; }
              } else {
                toolResult = { error: 'Which customer is this check for? Provide customer_name or customer_id.' };
              }
              if (!toolResult.error && scCustomerId) {
                const scToday = new Date().toISOString().split('T')[0];
                let scB64 = null, scMime = 'image/jpeg';
                try { const { base64, mimeType } = await fetchFileAsBase64(String(scUrl)); if (base64) { scB64 = base64; scMime = mimeType || 'image/jpeg'; } } catch (e) { console.warn('[Lexi] scan_check img:', e.message); }
                if (!scB64) {
                  toolResult = { error: 'Could not read the check image. Ensure the file was uploaded successfully.' };
                } else {
                  let scX = {};
                  try {
                    const scGR = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: scMime, data: scB64 } }, { text: `Extract check details as JSON: amount (number, no $ or commas), check_number (string), check_date (YYYY-MM-DD), payer_name (string), memo (string or null). Today is ${scToday}. Never return a future date — use today if unclear. Return JSON only.` }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 256, responseMimeType: 'application/json' } }) }, { timeoutMs: 30000 });
                    const scGD = await scGR.json();
                    if (!scGD.error) { try { scX = JSON.parse(scGD.candidates?.[0]?.content?.parts?.[0]?.text || '{}'); } catch (e) {} }
                  } catch (e) { console.warn('[Lexi] scan_check AI:', e.message); }
                  const { amount: scAmt, check_number: scChkNum, check_date: scChkDate, payer_name: scPayer, memo: scMemo } = scX;
                  let scDate = scToday;
                  if (typeof scChkDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(scChkDate)) {
                    const scPd = new Date(scChkDate + 'T00:00:00Z');
                    if (!isNaN(scPd.getTime()) && scPd <= new Date()) { const scDf = (Date.now() - scPd.getTime()) / 86400000; if (scDf <= 180) { scDate = scChkDate; } else { const [,sm,sd] = scChkDate.split('-').map(Number); const sc = new Date(new Date().getFullYear(), (sm||1)-1, sd||1); if (sc <= new Date()) scDate = sc.toISOString().split('T')[0]; } }
                  }
                  let scPmtNum = `PMT-${Date.now().toString().slice(-6)}`;
                  try { const scLp = await pool.query(`SELECT payment_number FROM payments WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`, [actualCompanyId]); if (scLp.rows.length > 0 && scLp.rows[0].payment_number) { const scM = scLp.rows[0].payment_number.match(/\d+$/); if (scM) scPmtNum = `PMT-${String(parseInt(scM[0])+1).padStart(5,'0')}`; } } catch (e) {}
                  try { await pool.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'Document',$2,$3,NOW(),NOW())`, [crypto.randomUUID(), String(actualCompanyId), JSON.stringify({ company_id: String(actualCompanyId), document_name: `Check ${scChkNum||scPmtNum}`, file_url: scUrl, category: 'Check', related_entity_type: 'Customer', related_entity_id: scCustomerId, description: `Check: $${scAmt||0} from ${scPayer||'N/A'}`, uploaded_by: effectiveEmail })]); } catch (e) {}
                  const scPmtId = crypto.randomUUID();
                  await pool.query(`INSERT INTO payments (id,company_id,customer_id,customer_name,payment_number,amount,payment_method,payment_date,reference_number,notes,status,file_url,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'check',$7,$8,$9,'received',$10,NOW(),NOW())`,
                    [scPmtId, actualCompanyId, scCustomerId, scCustomerName, scPmtNum, scAmt||0, scDate, scChkNum||'', scMemo ? `Payer: ${scPayer||'N/A'}\nMemo: ${scMemo}` : `Payer: ${scPayer||'N/A'}`, scUrl]);
                  toolResult = { success: true, payment_number: scPmtNum, customer: scCustomerName, amount: scAmt, check_number: scChkNum, check_date: scDate, payer_name: scPayer, message: `✅ Check payment recorded for ${scCustomerName} — $${scAmt||0}, Check #${scChkNum||'N/A'}, Date: ${scDate}` };
                  actionsExecuted.push({ tool_name: 'scan_check', result: `Check payment $${scAmt||0} recorded for ${scCustomerName}` });
                }
              }
            }
          } else if (fname === 'read_emails') {
            const { query: gmQ, limit: gmL, unread_only: gmU } = args;
            const gmTok = await getGmailTokenForCompany(pool, actualCompanyId);
            if (!gmTok) {
              toolResult = { error: 'Gmail is not connected. Ask the owner to go to Settings → Integrations and connect their Gmail account, then try again.' };
            } else {
              try {
                const gmLimit = Math.min(gmL || 10, 10);
                let gmSearch = gmQ || 'in:inbox';
                if (gmU) gmSearch = `is:unread ${gmSearch}`;
                const gmList = await gmailApiCall(gmTok.token, `/messages?q=${encodeURIComponent(gmSearch)}&maxResults=${gmLimit}`);
                const gmMsgs = gmList.messages || [];
                if (gmMsgs.length === 0) {
                  toolResult = { emails: [], count: 0, message: 'No emails found matching your search.' };
                } else {
                  const gmDetails = await Promise.all(gmMsgs.slice(0, gmLimit).map(async m => {
                    try {
                      const md = await gmailApiCall(gmTok.token, `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
                      const hdrs = Object.fromEntries((md.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
                      return { id: m.id, from: hdrs.from, to: hdrs.to, subject: hdrs.subject, date: hdrs.date, snippet: md.snippet, unread: (md.labelIds || []).includes('UNREAD'), thread_id: md.threadId };
                    } catch (e) { return { id: m.id, error: e.message }; }
                  }));
                  toolResult = { emails: gmDetails, count: gmDetails.length, gmail_account: gmTok.gmail_email };
                  actionsExecuted.push({ tool_name: 'read_emails', result: `Fetched ${gmDetails.length} emails` });
                }
              } catch (gmErr) { toolResult = { error: `Gmail error: ${gmErr.message}` }; }
            }
          } else if (fname === 'get_email') {
            const { email_id: gmId } = args;
            if (!gmId) { toolResult = { error: 'email_id is required' }; }
            else {
              const gmTok = await getGmailTokenForCompany(pool, actualCompanyId);
              if (!gmTok) { toolResult = { error: 'Gmail is not connected.' }; }
              else {
                try {
                  const gmMsg = await gmailApiCall(gmTok.token, `/messages/${gmId}?format=full`);
                  const gmHdrs = Object.fromEntries((gmMsg.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
                  function gmExtractBody(payload) {
                    if (payload.mimeType === 'text/plain' && payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
                    if (payload.parts) { for (const p of payload.parts) { const t = gmExtractBody(p); if (t) return t; } }
                    if (payload.mimeType?.startsWith('text/') && payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
                    return '';
                  }
                  const gmBody = gmExtractBody(gmMsg.payload || {}).substring(0, 4000);
                  toolResult = { id: gmId, from: gmHdrs.from, to: gmHdrs.to, subject: gmHdrs.subject, date: gmHdrs.date, body: gmBody, thread_id: gmMsg.threadId, unread: (gmMsg.labelIds || []).includes('UNREAD') };
                  actionsExecuted.push({ tool_name: 'get_email', result: `Read email: ${gmHdrs.subject}` });
                } catch (gmErr) { toolResult = { error: `Gmail error: ${gmErr.message}` }; }
              }
            }
          } else if (fname === 'reply_to_email') {
            const { email_id: gmReId, body: gmReBody } = args;
            if (!gmReId || !gmReBody) { toolResult = { error: 'email_id and body are both required' }; }
            else {
              const gmTok = await getGmailTokenForCompany(pool, actualCompanyId);
              if (!gmTok) { toolResult = { error: 'Gmail is not connected.' }; }
              else {
                try {
                  const gmOrig = await gmailApiCall(gmTok.token, `/messages/${gmReId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Message-ID`);
                  const gmHdrs = Object.fromEntries((gmOrig.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
                  const gmSubject = gmHdrs.subject?.startsWith('Re:') ? gmHdrs.subject : `Re: ${gmHdrs.subject || '(no subject)'}`;
                  const gmReplyTo = gmHdrs.from || '';
                  const gmMsgId = gmHdrs['message-id'] || '';
                  const gmRaw = [`From: ${gmTok.gmail_email}`, `To: ${gmReplyTo}`, `Subject: ${gmSubject}`, `In-Reply-To: ${gmMsgId}`, `References: ${gmMsgId}`, `Content-Type: text/plain; charset=utf-8`, ``, gmReBody].join('\r\n');
                  const gmEncoded = Buffer.from(gmRaw).toString('base64url');
                  await gmailApiCall(gmTok.token, '/messages/send', 'POST', { raw: gmEncoded, threadId: gmOrig.threadId });
                  toolResult = { success: true, message: `Reply sent to ${gmReplyTo}`, subject: gmSubject };
                  actionsExecuted.push({ tool_name: 'reply_to_email', result: `Replied to email: ${gmSubject}` });
                } catch (gmErr) { toolResult = { error: `Gmail error: ${gmErr.message}` }; }
              }
            }
          } else if (fname === 'mark_email_read') {
            const { email_id: gmMrId } = args;
            if (!gmMrId) { toolResult = { error: 'email_id is required' }; }
            else {
              const gmTok = await getGmailTokenForCompany(pool, actualCompanyId);
              if (!gmTok) { toolResult = { error: 'Gmail is not connected.' }; }
              else {
                try {
                  await gmailApiCall(gmTok.token, `/messages/${gmMrId}/modify`, 'POST', { removeLabelIds: ['UNREAD'] });
                  toolResult = { success: true, message: 'Email marked as read' };
                  actionsExecuted.push({ tool_name: 'mark_email_read', result: 'Email marked as read' });
                } catch (gmErr) { toolResult = { error: `Gmail error: ${gmErr.message}` }; }
              }
            }
          } else if (fname === 'find_claim_documents') {
            const cdQuery = (args.query || '').toLowerCase().trim();
            const cdType = args.type || 'all';
            const CD_MASTER_IDS = ['695944e3c1fb00b7ab716c6f', 'companysync_master_001'];
            const cdResults = { templates: [], documents: [] };
            if (cdType === 'all' || cdType === 'email_templates') {
              const tplIds = [actualCompanyId, ...CD_MASTER_IDS];
              const tplPH = tplIds.map((_, i) => `$${i + 1}`).join(',');
              const tplRes = await pool.query(
                `SELECT id, data FROM generic_entities
                 WHERE entity_type = 'EmailTemplate'
                   AND company_id IN (${tplPH})
                   AND data->>'category' IN ('insurance_rebuttals','matching_letters')
                 ORDER BY created_date DESC LIMIT 50`,
                tplIds
              );
              for (const row of tplRes.rows) {
                const d = row.data || {};
                const name = d.template_name || d.name || '';
                const subj = d.subject || '';
                const body = d.body || '';
                if (!cdQuery || name.toLowerCase().includes(cdQuery) || subj.toLowerCase().includes(cdQuery) || body.toLowerCase().includes(cdQuery)) {
                  cdResults.templates.push({ id: row.id, name, subject: subj, category: d.category || '', preview: body.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 400), full_body: body });
                }
              }
            }
            if (cdType === 'all' || cdType === 'documents') {
              const docRes = await pool.query(
                `SELECT id, data FROM generic_entities
                 WHERE entity_type = 'Document' AND company_id = $1
                   AND data->>'category' IN ('supplier_letters','rebuttal_docs')
                 ORDER BY created_date DESC LIMIT 50`,
                [actualCompanyId]
              );
              for (const row of docRes.rows) {
                const d = row.data || {};
                const name = d.document_name || d.name || '';
                const desc = d.description || '';
                if (!cdQuery || name.toLowerCase().includes(cdQuery) || desc.toLowerCase().includes(cdQuery)) {
                  cdResults.documents.push({ id: row.id, name, description: desc, category: d.category || '', file_url: d.file_url || '' });
                }
              }
            }
            const cdTotal = cdResults.templates.length + cdResults.documents.length;
            toolResult = { ...cdResults, total: cdTotal, query: args.query || null };
            actionsExecuted.push({ tool_name: 'find_claim_documents', result: `Found ${cdTotal} claim document(s): ${cdResults.templates.length} template(s), ${cdResults.documents.length} document(s)` });
          } else if (fname === 'find_documents') {
            if (!isAdmin) {
              toolResult = lexiAccessDenied('Document-library search is available to administrators because files can be company-wide. I can still help with documents attached to your assigned records.');
            } else {
              const query = String(args.query || '').trim().toLowerCase();
              const limit = Math.max(1, Math.min(Number(args.limit) || 10, 25));
              const rows = await pool.query(`SELECT id, data, created_date FROM generic_entities WHERE entity_type='Document' AND company_id=$1 ORDER BY created_date DESC LIMIT 200`, [actualCompanyId]);
              const documents = rows.rows.map(r => {
                const d = typeof r.data === 'string' ? JSON.parse(r.data || '{}') : (r.data || {});
                const haystack = [d.document_name, d.name, d.description, d.related_entity_name, d.customer_name, d.lead_name, d.category].filter(Boolean).join(' ').toLowerCase();
                return { id: r.id, name: d.document_name || d.name || 'Untitled document', description: d.description || '', category: d.category || '', file_url: d.file_url || '', related_entity_type: d.related_entity_type || null, related_entity_id: d.related_entity_id || null, created_date: r.created_date, matches: !query || haystack.includes(query) };
              }).filter(d => d.matches).slice(0, limit);
              toolResult = { total: documents.length, query: query || null, documents };
              actionsExecuted.push({ tool_name: 'find_documents', result: `Found ${documents.length} document(s)` });
            }
          } else if (fname === 'get_customer_payment_status') {
            const requested = String(args.customer_name || '').trim();
            let customerRows;
            if (args.customer_id) customerRows = await pool.query(`SELECT id,name FROM customers WHERE id=$1 AND company_id=$2${!isAdmin ? ` AND ${ownRecordCondition('customers', '$3')}` : ''} LIMIT 1`, isAdmin ? [args.customer_id, actualCompanyId] : [args.customer_id, actualCompanyId, effectiveEmail]);
            else if (requested) customerRows = isAdmin
              ? await pool.query(`SELECT id,name FROM customers WHERE company_id=$1 AND LOWER(name) LIKE $2 ORDER BY (LOWER(name)=LOWER($3)) DESC, created_at DESC LIMIT 5`, [actualCompanyId, `%${requested}%`, requested])
              : await pool.query(`SELECT id,name FROM customers WHERE company_id=$1 AND LOWER(name) LIKE $2 AND ${ownRecordCondition('customers', '$3')} ORDER BY created_at DESC LIMIT 5`, [actualCompanyId, `%${requested}%`, effectiveEmail]);
            else customerRows = { rows: [] };
            if (customerRows.rows.length !== 1) toolResult = { success: false, error: customerRows.rows.length ? `Multiple customers match "${requested}". Please provide the full name.` : 'No accessible customer matched that name.' };
            else {
              const customer = customerRows.rows[0];
              const inv = await pool.query(`SELECT invoice_number,total_amount,amount_paid,status FROM invoices WHERE company_id=$1 AND customer_id=$2 AND COALESCE(status,'') NOT IN ('void','cancelled') ORDER BY created_at DESC`, [actualCompanyId, customer.id]);
              const totals = inv.rows.reduce((a, r) => ({ invoiced:a.invoiced+Number(r.total_amount||0), paid:a.paid+Number(r.amount_paid||0) }), { invoiced:0, paid:0 });
              const balance = Math.max(0, totals.invoiced - totals.paid);
              toolResult = { customer_id: customer.id, customer_name: customer.name, paid_in_full: inv.rows.length > 0 && balance <= 0.005, total_invoiced: totals.invoiced, total_paid: totals.paid, balance_due: balance, invoices: inv.rows.map(r => ({ invoice_number:r.invoice_number, total_amount:Number(r.total_amount||0), amount_paid:Number(r.amount_paid||0), balance_due:Math.max(0, Number(r.total_amount||0)-Number(r.amount_paid||0)), status:r.status })) };
              actionsExecuted.push({ tool_name: 'get_customer_payment_status', result: `${customer.name}: ${balance <= 0.005 ? 'paid in full' : `$${balance.toFixed(2)} due`}` });
            }
          } else if (fname === 'record_payment') {
            const { amount: rpAmt, payment_method: rpMethod, customer_name: rpCustName, customer_id: rpCustId,
                    invoice_number: rpInvNum, payment_date: rpDateRaw, reference_number: rpRef, notes: rpNotes } = args;
            if (!rpAmt || isNaN(Number(rpAmt)) || Number(rpAmt) <= 0) {
              toolResult = { error: 'A valid payment amount greater than zero is required.' };
            } else {
              const rpToday = new Date().toISOString().split('T')[0];
              const rpDate = (typeof rpDateRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rpDateRaw)) ? rpDateRaw : rpToday;
              let rpCustomerId = rpCustId || null;
              let rpCustomerName = '';
              let rpInvoiceId = null;
              let rpInvoiceNumber = rpInvNum || null;
              if (rpInvNum) {
                const rpIR = await pool.query(
                  `SELECT id, invoice_number, customer_id, customer_name FROM invoices WHERE company_id = $1 AND LOWER(invoice_number) = LOWER($2) LIMIT 1`,
                  [actualCompanyId, rpInvNum.trim()]
                );
                if (rpIR.rows.length > 0) {
                  rpInvoiceId = rpIR.rows[0].id;
                  rpInvoiceNumber = rpIR.rows[0].invoice_number;
                  if (!rpCustomerId) rpCustomerId = rpIR.rows[0].customer_id;
                  if (!rpCustomerName) rpCustomerName = rpIR.rows[0].customer_name || '';
                } else {
                  rpInvoiceNumber = rpInvNum.trim();
                }
              }
              if (!toolResult.error) {
                if (rpCustomerId && !rpCustomerName) {
                  const rpCR = await pool.query(`SELECT id, name FROM customers WHERE id::text = $1 AND company_id = $2 LIMIT 1`, [String(rpCustomerId), actualCompanyId]);
                  if (rpCR.rows.length > 0) rpCustomerName = rpCR.rows[0].name;
                } else if (!rpCustomerId && rpCustName) {
                  const rpCn = rpCustName.trim().toLowerCase();
                  const rpCR = await pool.query(
                    `SELECT id, name FROM customers WHERE company_id = $1 AND LOWER(name) LIKE $2 ORDER BY (LOWER(name) = $3) DESC, created_at DESC LIMIT 5`,
                    [actualCompanyId, `%${rpCn}%`, rpCn]
                  );
                  if (rpCR.rows.length === 0) {
                    toolResult = { error: `No customer found matching "${rpCustName}". Please check the name.` };
                  } else {
                    rpCustomerId = rpCR.rows[0].id;
                    rpCustomerName = rpCR.rows[0].name;
                  }
                } else if (!rpCustomerId && !rpCustName && !rpInvNum) {
                  toolResult = { error: 'Who is this payment from? Please provide a customer name or invoice number.' };
                }
              }
              if (!toolResult.error) {
                let rpPmtNum = `PMT-${Date.now().toString().slice(-6)}`;
                try {
                  const rpLP = await pool.query(`SELECT payment_number FROM payments WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`, [actualCompanyId]);
                  if (rpLP.rows.length > 0 && rpLP.rows[0].payment_number) {
                    const rpM = rpLP.rows[0].payment_number.match(/\d+$/);
                    if (rpM) rpPmtNum = `PMT-${String(parseInt(rpM[0]) + 1).padStart(5, '0')}`;
                  }
                } catch (e) {}
                const rpPmtId = randomUUID();
                await pool.query(
                  `INSERT INTO payments (id,company_id,customer_id,customer_name,invoice_id,invoice_number,payment_number,amount,payment_method,payment_date,reference_number,notes,status,created_at,updated_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'received',NOW(),NOW())`,
                  [rpPmtId, actualCompanyId, rpCustomerId || null, rpCustomerName || null,
                   rpInvoiceId || null, rpInvoiceNumber || null, rpPmtNum,
                   Number(rpAmt), rpMethod || 'other', rpDate,
                   rpRef || null, rpNotes || null]
                );
                const methodLabel = { cash: 'Cash', check: 'Check', credit_card: 'Credit Card', bank_transfer: 'Bank Transfer', paypal: 'PayPal', stripe: 'Stripe', other: 'Other' }[rpMethod] || rpMethod;
                try {
                  const rpAdminQ = await pool.query(
                    `SELECT COALESCE(NULLIF(user_email,''), email) AS email FROM staff_profiles WHERE company_id = $1 AND is_administrator = true AND is_active = true AND COALESCE(NULLIF(user_email,''), email) IS NOT NULL`,
                    [actualCompanyId]
                  );
                  const rpNTitle = `💰 Payment Recorded: $${Number(rpAmt).toFixed(2)}`;
                  const rpNMsg = `${rpPmtNum}: $${Number(rpAmt).toFixed(2)} by ${methodLabel}` +
                    (rpCustomerName ? ` from ${rpCustomerName}` : '') +
                    (rpInvoiceNumber ? `, Invoice ${rpInvoiceNumber}` : '') +
                    (rpRef ? `, Ref: ${rpRef}` : '') + ' (logged by Lexi)';
                  for (const adm of rpAdminQ.rows) {
                    await pool.query(
                      `INSERT INTO generic_entities (entity_type, company_id, data, created_date, updated_date) VALUES ($1, $2, $3, NOW(), NOW())`,
                      ['Notification', actualCompanyId, JSON.stringify({ company_id: actualCompanyId, user_email: adm.email, title: rpNTitle, message: rpNMsg, type: 'payment_received', link_url: '/payments', is_read: false })]
                    );
                    sendViaResendProd({ to: adm.email, subject: rpNTitle, html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2 style="color:#16a34a">${rpNTitle}</h2><p style="font-size:15px">${rpNMsg}</p><a href="https://getcompanysync.com/payments" style="display:inline-block;background:#3b82f6;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;margin-top:12px">View Payments</a></div>` }).catch(() => {});
                  }
                } catch (rpNErr) { console.warn('[Lexi] record_payment notify:', rpNErr.message); }
                const msg = `✅ Payment recorded — ${rpPmtNum}: $${Number(rpAmt).toFixed(2)} by ${methodLabel}` +
                  (rpCustomerName ? ` from ${rpCustomerName}` : '') +
                  (rpInvoiceNumber ? `, applied to ${rpInvoiceNumber}` : '') +
                  (rpRef ? `, Ref: ${rpRef}` : '');
                toolResult = { success: true, payment_number: rpPmtNum, customer: rpCustomerName, invoice: rpInvoiceNumber, amount: Number(rpAmt), method: methodLabel, date: rpDate, message: msg };
                actionsExecuted.push({ tool_name: 'record_payment', result: `Payment $${Number(rpAmt).toFixed(2)} recorded for ${rpCustomerName || 'customer'}` });
              }
            }
          } else if (fname === 'lookup_customer_by_phone') {
            const rawPhone = String(args.phone || '').replace(/[^\d+]/g, '');
            if (!rawPhone || rawPhone.replace(/\D/g,'').length < 7) {
              toolResult = { error: 'A valid phone number is required.' };
            } else {
              try {
                const lookup = await lookupCallerByCrmPhone(pool, actualCompanyId, rawPhone);
                if (!lookup || !lookup.name) {
                  toolResult = { found: false, phone: rawPhone, message: 'No customer or lead found for this number.' };
                } else {
                  const snap = { found: true, name: lookup.name, source: lookup.source, phone: rawPhone };
                  let custId = lookup.source === 'customer' ? (lookup.record?.id || null) : null;
                  if (!custId) {
                    const digits = rawPhone.replace(/\D/g, '');
                    const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
                    if (last10) {
                      const { rows: custByPhone } = await pool.query(
                        `SELECT id FROM customers WHERE company_id=$1 AND regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g') LIKE '%'||$2 LIMIT 1`,
                        [actualCompanyId, last10]
                      );
                      if (custByPhone[0]) { custId = custByPhone[0].id; snap.source = 'customer'; }
                    }
                  }
                  const custName = lookup.name;
                  if (custId) {
                    snap.customer_id = custId;
                    const { rows: pr } = await pool.query(
                      `SELECT id, title, status, current_milestone, assigned_to FROM projects WHERE company_id=$1 AND customer_id=$2 ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
                      [actualCompanyId, custId]
                    );
                    if (pr[0]) snap.project = { id: pr[0].id, title: pr[0].title, status: pr[0].status, milestone: pr[0].current_milestone, assigned_to: pr[0].assigned_to };
                    const { rows: bs } = await pool.query(
                      `SELECT data FROM generic_entities WHERE entity_type='BuildSchedule' AND company_id=$1 AND (data->>'customer_id'=$2 OR data->>'customer_name' ILIKE $3) ORDER BY (data->>'build_date') DESC NULLS LAST LIMIT 1`,
                      [actualCompanyId, custId, custName ? '%' + custName + '%' : null]
                    );
                    if (bs[0]) { const bd = bs[0].data || {}; snap.build_schedule = { build_date: bd.build_date || null, stage: bd.status || bd.stage || null, crew: bd.assigned_crew || bd.crew_name || null, address: bd.address || null }; }
                    const { rows: tk } = await pool.query(
                      `SELECT title, name, status, priority, due_date, assigned_to FROM tasks WHERE company_id=$1 AND customer_id=$2 AND COALESCE(status,'pending') NOT IN ('done','completed','cancelled') ORDER BY due_date ASC NULLS LAST LIMIT 5`,
                      [actualCompanyId, custId]
                    );
                    if (tk.length > 0) snap.open_tasks = tk.map(t => ({ title: t.title || t.name, status: t.status, due_date: t.due_date || null, assigned_to: t.assigned_to || null }));
                    const { rows: inv } = await pool.query(
                      `SELECT SUM(total_amount - COALESCE(amount_paid,0)) AS balance FROM invoices WHERE company_id=$1 AND customer_id=$2 AND COALESCE(status,'') NOT IN ('paid','void','cancelled')`,
                      [actualCompanyId, custId]
                    );
                    const bal = Number(inv[0]?.balance || 0);
                    if (bal > 0) snap.outstanding_balance = '$' + bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  }
                  toolResult = snap;
                  actionsExecuted.push({ tool_name: 'lookup_customer_by_phone', result: `Found: ${lookup.name} (${lookup.source})` });
                }
              } catch (lcpErr) { toolResult = { error: `Lookup failed: ${lcpErr.message}` }; }
            }
          } else if (fname === 'get_build_schedule') {
            const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
            const values = [actualCompanyId];
            let where = `entity_type='BuildSchedule' AND company_id=$1`;
            const add = (sql, value) => { values.push(value); where += ` AND ${sql.replace('?', '$' + values.length)}`; };
            if (args.customer_id) add(`data->>'customer_id'=?`, args.customer_id);
            if (args.customer_name) add(`data->>'customer_name' ILIKE ?`, `%${args.customer_name}%`);
            if (args.status) add(`LOWER(COALESCE(data->>'status',''))=LOWER(?)`, args.status);
            if (args.job_type) add(`LOWER(COALESCE(data->>'job_type','')) LIKE LOWER(?)`, `%${args.job_type}%`);
            if (args.date_from) add(`data->>'build_date'>=?`, args.date_from);
            if (args.date_to) add(`data->>'build_date'<=?`, args.date_to);
            if (!isAdmin) {
              values.push(effectiveUserEmail, effectiveUserEmail, effectiveUserEmail);
              const p = values.length;
              where += ` AND (LOWER(COALESCE(data->>'created_by',''))=LOWER($${p - 2}) OR LOWER(COALESCE(data->>'rep_email',''))=LOWER($${p - 1}) OR COALESCE(data->'assigned_to_users','[]'::jsonb) @> jsonb_build_array(to_jsonb($${p}::text)))`;
            }
            const { rows } = await pool.query(`SELECT id, data FROM generic_entities WHERE ${where} ORDER BY (data->>'build_date') ASC NULLS LAST LIMIT ${limit}`, values);
            toolResult = { count: rows.length, builds: rows.map(r => { const b = r.data || {}; return { id: r.id, customer_name: b.customer_name || null, customer_id: b.customer_id || null, build_date: b.build_date || null, status: b.status || 'scheduled', job_type: b.job_type || b.job_types || [], address: b.address || null, rep: b.rep || null, crew: b.crew || b.assigned_to || [], notes: b.notes || null }; }) };
            actionsExecuted.push({ tool_name: 'get_build_schedule', result: `Found ${rows.length} build schedule(s)` });
          } else if (fname === 'create_build_schedule') {
            const jobTypes = Array.isArray(args.job_types) ? args.job_types.filter(Boolean) : (args.job_type ? (Array.isArray(args.job_type) ? args.job_type : [args.job_type]) : []);
            if (!(args.customer_id || args.customer_name) || !args.build_date || jobTypes.length === 0) {
              toolResult = { error: 'Build requires customer_name or customer_id, build_date, and one or more job_types.' };
            } else {
              try { assertBuildDate(args.build_date); } catch (e) { toolResult = { error: e.message }; continue; }
              const accessSql = isAdmin ? '' : ` AND (LOWER(COALESCE(assigned_to,''))=LOWER($3) OR COALESCE(assigned_to_users,'[]'::jsonb) @> jsonb_build_array(to_jsonb($3::text)))`;
              const lookup = args.customer_id
                ? await pool.query(`SELECT id, name, phone, email, address FROM customers WHERE id=$1 AND company_id=$2${accessSql} LIMIT 3`, isAdmin ? [args.customer_id, actualCompanyId] : [args.customer_id, actualCompanyId, effectiveUserEmail])
                : await pool.query(`SELECT id, name, phone, email, address FROM customers WHERE company_id=$1 AND regexp_replace(name, '\\s+', ' ', 'g') ILIKE $2${accessSql} ORDER BY name LIMIT 3`, isAdmin ? [actualCompanyId, `%${String(args.customer_name || '').trim().replace(/\s+/g, ' ')}%`] : [actualCompanyId, `%${String(args.customer_name || '').trim().replace(/\s+/g, ' ')}%`, effectiveUserEmail]);
              if (!args.customer_id && lookup.rows.length > 1) {
                toolResult = { success: false, code: 'CUSTOMER_AMBIGUOUS', error: 'More than one customer matches that name. Please ask which customer they mean.', candidates: lookup.rows.map(row => ({ id: row.id, name: row.name })) };
                continue;
              }
              const customer = lookup.rows[0];
              if (!customer) toolResult = { error: 'Customer was not found in this company. Provide an existing customer name or ID.' };
              else {
                const confirmation = buildScheduleConfirmationGuard({
                  companyId: actualCompanyId, userEmail: effectiveUserEmail, action: 'create',
                  customerId: customer.id, customerName: customer.name,
                  buildDate: args.build_date, jobTypes,
                }, args.confirmation_token);
                if (confirmation) {
                  toolResult = confirmation;
                  continue;
                }
                const id = `build_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
                const assigned = isAdmin ? (Array.isArray(args.assigned_to) ? args.assigned_to : (args.assigned_to ? [args.assigned_to] : [effectiveUserEmail])) : [effectiveUserEmail];
                const data = { id, company_id: actualCompanyId, customer_id: customer.id, customer_name: customer.name, build_date: args.build_date, job_type: jobTypes, address: args.address || customer.address || '', customer_phone: args.customer_phone || customer.phone || '', customer_email: args.customer_email || customer.email || '', rep: isAdmin ? (args.rep || effectiveUserEmail) : effectiveUserEmail, rep_email: effectiveUserEmail, crew: args.crew || [], assigned_to: assigned, assigned_to_users: assigned, notes: args.notes || '', status: args.status || 'scheduled', created_by: effectiveUserEmail, created_at: new Date().toISOString() };
                const client = await pool.connect();
                try {
                  await client.query('BEGIN');
                  await client.query(`INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1,'BuildSchedule',$2,$3,NOW(),NOW())`, [id, actualCompanyId, JSON.stringify(data)]);
                  const day = buildDayRange(args.build_date, userTimeZone);
                  const cal = await client.query(`INSERT INTO calendar_events (id,title,start_time,end_time,event_type,company_id,assigned_to,created_by,location,description,status,created_at) VALUES ($1,$2,$3,$4,'build',$5,$6,$6,$7,$8,'scheduled',NOW()) RETURNING id`, [`cal_${id}`, `${jobTypes.join(' & ')}: ${customer.name}`, day.start_time, day.end_time, actualCompanyId, assigned[0] || effectiveUserEmail, data.address, data.notes || '']);
                  await client.query(`UPDATE generic_entities SET data=data || $1, updated_date=NOW() WHERE id=$2 AND company_id=$3`, [JSON.stringify({ calendar_event_id: cal.rows[0].id }), id, actualCompanyId]);
                  const verified = await client.query(`SELECT ge.data->>'calendar_event_id' AS calendar_event_id, EXISTS(SELECT 1 FROM calendar_events WHERE id=$2 AND company_id=$3) AS event_exists FROM generic_entities ge WHERE ge.id=$1 AND ge.entity_type='BuildSchedule' AND ge.company_id=$3`, [id, cal.rows[0].id, actualCompanyId]);
                  if (verified.rows[0]?.calendar_event_id !== cal.rows[0].id || !verified.rows[0]?.event_exists) throw new Error('Saved build records could not be verified');
                  await client.query('COMMIT'); toolResult = { success: true, build_id: id, calendar_event_id: cal.rows[0].id, customer_name: customer.name, build_date: args.build_date, job_type: jobTypes, status: data.status };
                  actionsExecuted.push({ tool_name: 'create_build_schedule', result: `Created build for ${customer.name}` });
                } catch (e) { await client.query('ROLLBACK').catch(() => {}); toolResult = { error: `No build was created: ${e.message}` }; } finally { client.release(); }
              }
            }
          } else if (fname === 'get_customer_build_schedule') {
            const bsCustId = args.customer_id || null;
            const bsCustName = args.customer_name || null;
            if (!bsCustId && !bsCustName) {
              toolResult = { error: 'Provide customer_id or customer_name.' };
            } else {
              try {
                const { rows: bsRows } = await pool.query(
                  `SELECT id, data FROM generic_entities WHERE entity_type='BuildSchedule' AND company_id=$1 AND (data->>'customer_id'=$2 OR data->>'customer_name' ILIKE $3) ORDER BY (data->>'build_date') DESC NULLS LAST LIMIT 3`,
                  [actualCompanyId, bsCustId || '', bsCustName ? '%' + bsCustName + '%' : '']
                );
                if (bsRows.length === 0) {
                  toolResult = { found: false, message: 'No build schedule found for this customer.' };
                } else {
                  toolResult = { found: true, count: bsRows.length, schedules: bsRows.map(r => { const bd = r.data || {}; return { build_date: bd.build_date || null, stage: bd.status || bd.stage || null, crew: bd.assigned_crew || bd.crew_name || null, address: bd.address || null, notes: bd.notes || null }; }) };
                  actionsExecuted.push({ tool_name: 'get_customer_build_schedule', result: `Found ${bsRows.length} build schedule(s)` });
                }
              } catch (bsErr) { toolResult = { error: `Build schedule lookup failed: ${bsErr.message}` }; }
            }
          } else if (fname === 'get_customer_open_tasks') {
            const tkCustId = args.customer_id || null;
            const tkCustName = args.customer_name || null;
            if (!tkCustId && !tkCustName) {
              toolResult = { error: 'Provide customer_id or customer_name.' };
            } else {
              try {
                let tkRows = [];
                if (tkCustId) {
                  const { rows } = await pool.query(
                    `SELECT title, name, status, priority, due_date, assigned_to FROM tasks WHERE company_id=$1 AND customer_id=$2 AND COALESCE(status,'pending') NOT IN ('done','completed','cancelled') ORDER BY due_date ASC NULLS LAST LIMIT 8`,
                    [actualCompanyId, tkCustId]
                  );
                  tkRows = rows;
                }
                if (tkRows.length === 0 && tkCustName) {
                  const { rows } = await pool.query(
                    `SELECT title, name, status, priority, due_date, assigned_to FROM tasks WHERE company_id=$1 AND (LOWER(customer_name) LIKE LOWER($2) OR data->>'customer_name' ILIKE $2) AND COALESCE(status,'pending') NOT IN ('done','completed','cancelled') ORDER BY due_date ASC NULLS LAST LIMIT 8`,
                    [actualCompanyId, '%' + tkCustName + '%']
                  );
                  tkRows = rows;
                }
                if (tkRows.length === 0) {
                  toolResult = { count: 0, message: 'No open tasks found for this customer.' };
                } else {
                  toolResult = { count: tkRows.length, tasks: tkRows.map(t => ({ title: t.title || t.name, status: t.status || 'pending', priority: t.priority || null, due_date: t.due_date || null, assigned_to: t.assigned_to || null })) };
                  actionsExecuted.push({ tool_name: 'get_customer_open_tasks', result: `Found ${tkRows.length} open tasks` });
                }
              } catch (tkErr) { toolResult = { error: `Task lookup failed: ${tkErr.message}` }; }
            }
          } else {
            toolResult = { error: `Tool "${fname}" is not available. You MUST tell the user you cannot complete this action instead of claiming it was done.` };
          }
        } catch (toolErr) {
          console.error(`[Lexi] Tool ${fname} error:`, toolErr.message);
          toolResult = { error: toolErr.message };
        } finally {
          // Runs on every exit from the tool body, including the `continue`
          // shortcuts, so a tool that bailed early still returns a response to
          // the model and still lands in the ledger. Already-pushed calls are
          // deduped, so an explicit push above wins.
          lastToolName = fname;
          lastToolResult = toolResult;
          pushGroundedToolResponse(fname, args, toolResult, fc);
        }
      }

      contents.push({ role: 'user', parts: functionResponseParts });
    }

    const draftResponse = finalResponse?.trim()
      || buildLexiToolFallback(lastToolName, lastToolResult)
      || "I couldn’t complete that request. Please try again.";
    // Last line of defence: a fabricated person or an unbacked dollar figure
    // never reaches the user, no matter what the model produced.
    let audit = auditLexiResponse(draftResponse, groundingLedger);
    if (audit.blocked) {
      console.warn(`[Lexi] Grounding audit blocked a response (${audit.reason}: ${audit.detail})`);
      const fallback = buildLexiToolFallback(lastToolName, lastToolResult);
      if (fallback && !lastToolResult?.error && lastToolResult?.success !== false) {
        const checkedFallback = auditLexiResponse(fallback, groundingLedger);
        if (!checkedFallback.blocked) audit = checkedFallback;
      }
    }

    return {
      response: audit.response,
      actions_executed: actionsExecuted,
    };

  } catch (err) {
    console.error('[Lexi] Chat error:', err.message);
    return { response: "I encountered an error processing your request. Please try again." };
  }
}

/**
 * Get the raw Buffer for a file by filename.
 * Checks object storage → DB binary → disk in order.
 * Returns null if not found anywhere.
 */
async function serveFileBuffer(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  // 1. Object storage
  try {
    const buf = await objStorage.downloadFromObjectStorage(fileName);
    if (buf) return buf;
  } catch (e) {}

  // 2. DB binary (pre-migration fallback)
  try {
    const prodDb = require('./prod-db.cjs');
    const pool = prodDb.getPool();
    const result = await pool.query('SELECT file_data FROM file_uploads WHERE id = $1 AND file_data IS NOT NULL', [fileName]);
    if (result.rows.length > 0) return result.rows[0].file_data;
  } catch (e) {}

  // 3. Disk
  const diskCandidates = [
    path.join(UPLOADS_DIR, fileName),
    path.join(process.cwd(), 'public', 'uploads', fileName),
    path.join(process.cwd(), 'public', fileName),
    path.join(process.cwd(), 'dist', fileName),
    path.join(process.cwd(), fileName),
  ];
  for (const diskPath of diskCandidates) {
    if (fs.existsSync(diskPath) && fs.statSync(diskPath).isFile()) {
      const buf = fs.readFileSync(diskPath);
      objStorage.uploadToObjectStorage(fileName, buf, mimeType).catch(() => {});
      return buf;
    }
  }
  return null;
}

async function serveUploadedFile(req, res, pathname) {
  const fileName = decodeURIComponent(pathname.replace('/uploads/', ''));
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = { 'Content-Type': mimeType, 'Cache-Control': 'public, max-age=31536000', 'Access-Control-Allow-Origin': '*' };

  // 1. Object storage first (primary store post-migration)
  try {
    const fileData = await objStorage.downloadFromObjectStorage(fileName);
    if (fileData) {
      res.writeHead(200, headers);
      res.end(fileData);
      // Cache to disk for next request
      writeLocalUploadCache(localUploadCache, path.join(UPLOADS_DIR, fileName), fileData);
      return true;
    }
  } catch (e) {
    console.warn('[serveUploadedFile] Object storage error:', e.message);
  }

  // 2. DB fallback (pre-migration files still have file_data)
  try {
    const prodDb = require('./prod-db.cjs');
    const pool = prodDb.getPool();
    const result = await pool.query('SELECT file_data, mime_type FROM file_uploads WHERE id = $1 AND file_data IS NOT NULL', [fileName]);
    if (result.rows.length > 0) {
      const { file_data, mime_type } = result.rows[0];
      // Cache to disk
      writeLocalUploadCache(localUploadCache, path.join(UPLOADS_DIR, fileName), file_data);
      res.writeHead(200, { ...headers, 'Content-Type': mime_type || mimeType });
      res.end(file_data);
      return true;
    }
  } catch (e) {
    console.error('[serveUploadedFile] DB lookup error:', e.message);
  }

  // 3. Disk fallback: uploads dir, public/ root, dist/ root
  const diskCandidates = [
    path.join(UPLOADS_DIR, fileName),
    path.join(process.cwd(), 'public', 'uploads', fileName),
    path.join(process.cwd(), 'public', fileName),
    path.join(process.cwd(), 'dist', fileName),
    path.join(process.cwd(), fileName),
  ];
  for (const diskPath of diskCandidates) {
    if (fs.existsSync(diskPath) && fs.statSync(diskPath).isFile()) {
      const fileData = fs.readFileSync(diskPath);
      res.writeHead(200, headers);
      res.end(fileData);
      // Upload to object storage so future requests bypass disk
      objStorage.uploadToObjectStorage(fileName, fileData, mimeType).catch(e =>
        console.warn('[serveUploadedFile] Async object storage upload failed:', e.message)
      );
      return true;
    }
  }

  console.warn(`[serveUploadedFile] not found in object storage, DB, or disk: ${fileName}`);
  return false;
}

let _executeWorkflowActionCache = null;
async function executeProdWorkflowAction(pool, step, entityData, companyId, entityType, entityId) {
  if (!_executeWorkflowActionCache) {
    try {
      const pluginPath = path.resolve(__dirname, '../vite-functions-plugin.js');
      const mod = await import(pluginPath);
      _executeWorkflowActionCache = mod.executeWorkflowAction || null;
    } catch(e) {
      console.error('[prodIntegrations] Could not load executeWorkflowAction:', e.message);
    }
  }
  if (typeof _executeWorkflowActionCache === 'function') {
    return _executeWorkflowActionCache(pool, step, entityData, companyId, entityType, entityId);
  }
  console.warn('[prodIntegrations] executeProdWorkflowAction: handler not available, skipping step');
  return { success: false, reason: 'Workflow email sender is unavailable.' };
}

function __setTestPluginAuthHelpers(helpers) {
  _pluginAuthHelpersCache = helpers;
}

module.exports = { handleUpload, handleInvokeLLM, handleSendEmail, handleFunctionInvoke, handleLexiChat, getFunctionHandlers, serveUploadedFile, serveFileBuffer, sendJson, executeProdWorkflowAction, sendEmailWithData, checkAIUsageProd, logUsageEventProd, __setTestPluginAuthHelpers };
