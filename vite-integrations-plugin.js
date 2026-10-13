import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHmac, timingSafeEqual } from 'crypto';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

const PUBLIC_ROOT = path.join(__dirname, 'public');
const nodeRequire = createRequire(import.meta.url);

const {
  registerLocalUploadCache,
  writeLocalUploadCache,
} = nodeRequire('./lib/local-upload-cache.cjs');
let _llmLogPool = null;
async function getLLMPool() {
  if (!_llmLogPool) {
    const pg = await import('pg');
    const Pool = pg.default.Pool || pg.Pool;
    _llmLogPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _llmLogPool;
}

function parseCookiesIntegrations(cookieHeader = '') {
  const result = {};
  cookieHeader.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) result[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return result;
}

function unsignCookieIntegrations(val, secret) {
  if (!val || !val.startsWith('s:')) return null;
  const data = val.slice(2);
  const lastDot = data.lastIndexOf('.');
  if (lastDot < 0) return null;
  const sid = data.slice(0, lastDot);
  const signature = data.slice(lastDot + 1);
  const expected = createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  // A cookie that merely looks signed is not a credential. The old helper
  // returned its session ID without verifying the HMAC, which made it unsafe
  // for protecting an outbound-email endpoint.
  if (signature.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? sid : null;
}

async function getAuthenticatedUserFromRequest(req) {
  try {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return null;
    const cookies = parseCookiesIntegrations(req.headers.cookie);
    const signed = cookies['connect.sid'];
    if (!signed) return null;
    const sid = unsignCookieIntegrations(signed, secret);
    if (!sid) return null;
    const pool = await getLLMPool();
    const sessRow = await pool.query('SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()', [sid]);
    if (!sessRow.rows.length) return null;
    const sess = typeof sessRow.rows[0].sess === 'string' ? JSON.parse(sessRow.rows[0].sess) : sessRow.rows[0].sess;
    const email = sess?.passport?.user?.claims?.email || sess?.user?.email;
    if (!email) return null;
    const userRow = await pool.query('SELECT company_id FROM users WHERE email = $1', [email]);
    return {
      email: email.toLowerCase(),
      companyId: userRow.rows[0]?.company_id || null,
      // Staff compose is an externally-visible write and must honor the
      // application-wide read-only impersonation policy.
      isImpersonating: Boolean(sess?.impersonating_company_id),
    };
  } catch { return null; }
}

async function getCompanyIdFromRequest(req) {
  const user = await getAuthenticatedUserFromRequest(req);
  return user?.companyId || null;
}

async function logLLMUsage(companyId) {
  if (!companyId) return;
  try {
    const pool = await getLLMPool();
    const usageMonth = new Date().toISOString().slice(0, 7);
    const id = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'SubscriptionUsage', $2, $3, NOW(), NOW())`,
      [id, companyId, JSON.stringify({ company_id: companyId, feature: 'ai', units: 1, unit_cost: 0.01, total_cost: 0.01, usage_month: usageMonth })]
    );
  } catch { /* silent fail */ }
}

const localUploadCache = registerLocalUploadCache({
  uploadsDir: UPLOADS_DIR,
  publicRoot: PUBLIC_ROOT,
});
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(Buffer.concat(chunks));
      } catch (e) {
        resolve(Buffer.alloc(0));
      }
    });
    req.on('error', reject);
  });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function fetchFileAsBase64(url) {
  console.log(`[Integrations] Fetching file from URL: ${url.substring(0, 100)}`);

  const uploadsMatch = url.match(/\/uploads\/([^?#]+)/);
  if (uploadsMatch) {
    const localPath = path.join(UPLOADS_DIR, uploadsMatch[1]);
    if (fs.existsSync(localPath)) {
      console.log(`[Integrations] Reading local file: ${localPath}`);
      const buffer = fs.readFileSync(localPath);
      const ext = path.extname(localPath).toLowerCase();
      const mimeMap = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
        '.doc': 'application/msword', '.txt': 'text/plain', '.csv': 'text/csv',
      };
      return { base64: buffer.toString('base64'), mimeType: mimeMap[ext] || 'application/octet-stream' };
    }
  }

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch file: ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const mimeType = resp.headers.get('content-type') || 'application/octet-stream';
  return { base64, mimeType };
}

let _integrationLogPool = null;

async function logIntegrationActivity(service, action, status, details = {}) {
  try {
    if (!_integrationLogPool) {
      const pg = await import('pg');
      _integrationLogPool = new pg.default.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    }
    const id = `intlog_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const logData = {
      service,
      action,
      status,
      timestamp: new Date().toISOString(),
      duration_ms: details.duration_ms || null,
      error_message: details.error || null,
      details: details.meta || null,
    };
    await _integrationLogPool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'IntegrationLog', 'companysync_master_001', $2, NOW(), NOW())`,
      [id, JSON.stringify(logData)]
    );
  } catch (e) {
    /* silently fail logging to avoid disrupting main operations */
  }
}

// Shared timeout + bounded-retry wrapper for outbound AI API calls, mirroring the
// one in vite-functions-plugin.js (kept as a local copy since these are separate
// Vite plugin modules). Retries transient failures only: timeout/abort and 429/5xx.
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

async function callGeminiWithSchema(apiKey, prompt, options = {}) {
  const { fileUrls = [], responseJsonSchema, model = 'gemini-2.5-flash' } = options;

  console.log(`[Integrations] InvokeLLM: model=${model}, prompt_length=${prompt?.length || 0}, file_urls=${fileUrls.length}, has_schema=${!!responseJsonSchema}`);

  const parts = [];

  for (const url of fileUrls) {
    try {
      const { base64, mimeType } = await fetchFileAsBase64(url);
      parts.push({ inlineData: { mimeType, data: base64 } });
      console.log(`[Integrations] Added file: ${mimeType}, ${Math.round(base64.length / 1024)}KB`);
    } catch (err) {
      console.error(`[Integrations] Failed to fetch file ${url}: ${err.message}`);
    }
  }

  parts.push({ text: prompt });

  const generationConfig = {
    temperature: 0.2,
  };

  if (responseJsonSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = responseJsonSchema;
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig,
  };

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  console.log(`[Integrations] Calling Gemini API (${model})...`);
  const startTime = Date.now();

  // Uploaded reports can take longer to parse than conversational prompts.
  // Do not multiply that wait with provider retries: one longer document
  // request is both more reliable and much less expensive for the user.
  const isDocumentAnalysis = fileUrls.length > 0;
  const response = await fetchWithRetry(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { timeoutMs: isDocumentAnalysis ? 150000 : 60000, retries: isDocumentAnalysis ? 0 : 2 });

  const data = await response.json();
  const elapsed = Date.now() - startTime;

  if (data.error) {
    console.error(`[Integrations] Gemini API error (${elapsed}ms):`, data.error.message || JSON.stringify(data.error));
    logIntegrationActivity('Google Gemini', 'InvokeLLM', 'error', { duration_ms: elapsed, error: data.error.message, meta: { model } });
    throw new Error(data.error.message || 'Gemini API error');
  }

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    console.error(`[Integrations] Gemini returned no text (${elapsed}ms). Full response:`, JSON.stringify(data).substring(0, 500));
    logIntegrationActivity('Google Gemini', 'InvokeLLM', 'error', { duration_ms: elapsed, error: 'No text returned' });
    throw new Error('No valid response from Gemini');
  }

  console.log(`[Integrations] Gemini response received (${elapsed}ms), length=${rawText.length}`);
  logIntegrationActivity('Google Gemini', 'InvokeLLM', 'success', { duration_ms: elapsed, meta: { model, response_length: rawText.length } });

  if (responseJsonSchema) {
    try {
      return JSON.parse(rawText);
    } catch {
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) try { return JSON.parse(jsonMatch[1]); } catch {}
      const braceMatch = rawText.match(/[\[{][\s\S]*[\]}]/);
      if (braceMatch) try { return JSON.parse(braceMatch[0]); } catch {}
      console.warn(`[Integrations] Failed to parse JSON, returning raw text`);
      return rawText;
    }
  }

  return rawText;
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

export default function viteIntegrationsPlugin() {
  return {
    name: 'vite-integrations-plugin',
    configureServer(server) {
      // Image proxy — allows the browser to load any CDN-hosted image as
      // same-origin so canvas drawImage() isn't CORS-tainted and toBlob() works.
      server.middlewares.use('/api/proxy-image', async (req, res, next) => {
        const rawUrl = new URL(req.url, 'http://localhost').searchParams.get('url');
        if (!rawUrl) { res.writeHead(400); res.end('Missing url param'); return; }
        try {
          const https = await import('https');
          const http  = await import('http');
          const target = new URL(rawUrl);
          const client = target.protocol === 'https:' ? https : http;
          const proxyReq = client.get(rawUrl, (proxyRes) => {
            const ct = proxyRes.headers['content-type'] || 'image/jpeg';
            res.writeHead(200, {
              'Content-Type': ct,
              'Cache-Control': 'public, max-age=86400',
              'Access-Control-Allow-Origin': '*',
            });
            proxyRes.pipe(res);
          });
          proxyReq.on('error', (err) => {
            if (!res.headersSent) { res.writeHead(502); res.end(err.message); }
          });
        } catch (err) {
          if (!res.headersSent) { res.writeHead(500); res.end(err.message); }
        }
      });

      // Large app videos (training clips, marketing videos) live in Replit
      // Object Storage, not the repo — they made the publish image exceed the
      // 8 GiB limit. If the file isn't on local disk, 302 to a signed GCS URL
      // (GCS supports Range requests, so <video> seek works). Mirrors the
      // same fallback in prod-server.cjs.
      for (const videoPrefix of ['/videos', '/generated_marketing_videos']) {
        server.middlewares.use(videoPrefix, async (req, res, next) => {
          const decodedName = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
          if (!decodedName.endsWith('.mp4') || decodedName.includes('..')) return next();
          const localPath = path.join(process.cwd(), 'public', videoPrefix.slice(1), decodedName);
          if (fs.existsSync(localPath)) return next(); // let vite serve it
          try {
            const { getSignedUrl } = nodeRequire('./db/object-storage.cjs');
            const signed = await getSignedUrl(`${videoPrefix.slice(1)}/${decodedName}`, 'GET', 3600);
            res.writeHead(302, { Location: signed, 'Cache-Control': 'no-store' });
            res.end();
          } catch (e) {
            console.warn('[videos] object storage redirect failed:', e.message);
            next();
          }
        });
      }

      server.middlewares.use('/uploads', async (req, res, next) => {
        // req.url has the '/uploads' mount prefix already stripped by connect,
        // but keeps a leading slash (e.g. '/foo.png'). Strip it before using
        // the name as an object-storage key or a double-slash mismatch causes
        // a silent 404 there (local disk path.join tolerates it either way).
        const decodedName = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
        const filePath = path.join(UPLOADS_DIR, decodedName);
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
          '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
          '.pdf': 'application/pdf', '.doc': 'application/msword',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xls': 'application/vnd.ms-excel',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.csv': 'text/csv', '.txt': 'text/plain',
          '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
          '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
          '.html': 'text/html', '.htm': 'text/html',
        };
        if (fs.existsSync(filePath)) {
          res.writeHead(200, {
            'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000',
          });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
        // Fallback: not on local disk — try object storage (matches prod's
        // serveUploadedFile 3-tier lookup). Needed because some upload paths
        // write to object storage without a matching local disk copy.
        try {
          const { downloadFromObjectStorage } = nodeRequire('./db/object-storage.cjs');
          const fileData = await downloadFromObjectStorage(decodedName);
          if (fileData) {
            res.writeHead(200, {
              'Content-Type': mimeTypes[ext] || 'application/octet-stream',
              'Cache-Control': 'public, max-age=31536000',
            });
            res.end(fileData);
            // Cache to disk so subsequent requests skip the round trip.
            writeLocalUploadCache(localUploadCache, filePath, fileData);
            return;
          }
        } catch (e) {
          console.warn('[uploads] object storage fallback failed:', e.message);
        }
        next();
      });

      server.middlewares.use(async (req, res, next) => {
        if (req.method === 'OPTIONS' && req.url?.startsWith('/api/integrations/')) {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          });
          res.end();
          return;
        }

        if (req.url === '/api/integrations/upload' && req.method === 'POST') {
          try {
            console.log('[Integrations] UploadFile request received');
            const rawBody = await parseBody(req);
            const contentType = req.headers['content-type'] || '';

            let fileBuffer, fileName, fileMimeType;

            if (contentType.includes('multipart/form-data')) {
              const parts = parseMultipartFormData(rawBody, contentType);
              const filePart = parts?.find(p => p.filename);
              if (!filePart) {
                sendJson(res, { error: 'No file found in upload' }, 400);
                return;
              }
              fileBuffer = filePart.data;
              fileName = filePart.filename;
              fileMimeType = filePart.contentType;
            } else {
              sendJson(res, { error: 'Expected multipart/form-data' }, 400);
              return;
            }

            const MAX_FILE_SIZE = 50 * 1024 * 1024;
            if (fileBuffer.length > MAX_FILE_SIZE) {
              sendJson(res, { error: 'File too large. Maximum size is 50MB.' }, 400);
              return;
            }

            const ALLOWED_EXTENSIONS = new Set([
              '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
              '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt',
              '.heic', '.heif', '.bmp', '.tiff', '.tif', '.html', '.htm',
              '.webm', '.m4a', '.mp3', '.ogg', '.wav',
              // AI Estimator imports carrier/estimating exports in addition
              // to PDFs (frontend accepts these too).
              '.esx', '.xml',
            ]);
            const fileExt = path.extname(fileName).toLowerCase();
            if (!ALLOWED_EXTENSIONS.has(fileExt)) {
              sendJson(res, { error: `File type "${fileExt}" not allowed` }, 400);
              return;
            }

            const ext = path.extname(fileName).toLowerCase() || '.bin';
            const uniqueName = `${randomUUID()}${ext}`;
            const filePath = path.join(UPLOADS_DIR, uniqueName);

            writeLocalUploadCache(localUploadCache, filePath, fileBuffer);

            // Also write to public/ root so the file is accessible without /uploads/ prefix
            writeLocalUploadCache(localUploadCache, path.join(PUBLIC_ROOT, uniqueName), fileBuffer);

            // Also persist to shared DB so production can serve it
            try {
              const pool = await getLLMPool();
              await pool.query(
                'INSERT INTO file_uploads (id, original_filename, mime_type, file_size, file_data) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING',
                [uniqueName, fileName, fileMimeType || 'application/octet-stream', fileBuffer.length, fileBuffer]
              );
            } catch (dbErr) {
              console.warn('[Integrations] DB persist failed (non-fatal):', dbErr.message);
            }

            const protocol = req.headers['x-forwarded-proto'] || 'http';
            const host = req.headers['host'] || 'localhost:5000';
            const fileUrl = `${protocol}://${host}/uploads/${uniqueName}`;

            console.log(`[Integrations] File uploaded: ${fileName} -> ${uniqueName} (${Math.round(fileBuffer.length / 1024)}KB)`);

            sendJson(res, { file_url: fileUrl, file_name: fileName, size: fileBuffer.length });
          } catch (err) {
            console.error('[Integrations] Upload error:', err);
            sendJson(res, { error: err.message }, 500);
          }
          return;
        }

        if (req.url?.startsWith('/api/proxy-pdf') && req.method === 'GET') {
          try {
            const urlObj = new URL(req.url, 'http://localhost');
            const targetUrl = urlObj.searchParams.get('url');
            if (!targetUrl) {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('Missing url parameter');
              return;
            }
            const upstream = await fetch(targetUrl);
            if (!upstream.ok) {
              res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Upstream ${upstream.status}` }));
              return;
            }
            const buf = await upstream.arrayBuffer();
            res.writeHead(200, {
              'Content-Type': 'application/pdf',
              'Content-Disposition': 'inline',
              'Cache-Control': 'public, max-age=3600',
            });
            res.end(Buffer.from(buf));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        if (req.url === '/api/integrations/invoke-llm' && req.method === 'POST') {
          try {
            const body = await parseJsonBody(req);
            const { prompt, file_urls, response_json_schema, model, companyId: bodyCompanyId } = body;

            console.log('[Integrations] InvokeLLM request:', {
              prompt_length: prompt?.length || 0,
              file_urls: file_urls?.length || 0,
              has_schema: !!response_json_schema,
              model: model || 'default',
            });

            const TRIAL_DAILY_AI_LIMIT = 20;
            const cid = bodyCompanyId || await getCompanyIdFromRequest(req);

            if (cid && cid !== 'companysync_master_001') {
              try {
                const pool = await getLLMPool();
                const { rows: planRows } = await pool.query(
                  `SELECT subscription_plan FROM companies WHERE id = $1 LIMIT 1`, [cid]
                );
                const plan = planRows[0]?.subscription_plan || 'trial';
                if (plan === 'trial') {
                  const today = new Date().toISOString().slice(0, 10);
                  const recordId = `daily_ai_${cid}_${today}`;
                  const { rows: usageRows } = await pool.query(
                    `SELECT data FROM generic_entities WHERE id = $1 LIMIT 1`, [recordId]
                  );
                  const d = usageRows[0]?.data || {};
                  const used = (typeof d === 'string' ? JSON.parse(d) : d).count || 0;
                  if (used >= TRIAL_DAILY_AI_LIMIT) {
                    sendJson(res, {
                      error: 'daily_ai_limit_reached',
                      message: `You've used all ${TRIAL_DAILY_AI_LIMIT} free AI calls for today. Connect your own Google Gemini API key to remove this limit, or wait until midnight for the counter to reset.`,
                      limit: TRIAL_DAILY_AI_LIMIT,
                      used,
                      upgrade_url: '/APIKeysSettings'
                    }, 429);
                    return;
                  }
                }
              } catch (e) {
                console.warn('[DailyAI] Dev limit check failed (non-fatal):', e.message);
              }
            }

            const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
            if (!apiKey) {
              console.error('[Integrations] GOOGLE_GEMINI_API_KEY not configured!');
              sendJson(res, { error: 'GOOGLE_GEMINI_API_KEY not configured' }, 500);
              return;
            }

            if (!prompt) {
              sendJson(res, { error: 'prompt is required' }, 400);
              return;
            }

            const result = await callGeminiWithSchema(apiKey, prompt, {
              fileUrls: file_urls || [],
              responseJsonSchema: response_json_schema,
              model: model || 'gemini-2.5-flash',
            });

            console.log('[Integrations] InvokeLLM success, result type:', typeof result);
            sendJson(res, { response: result });

            if (cid && cid !== 'companysync_master_001') {
              getLLMPool().then(pool => {
                const today = new Date().toISOString().slice(0, 10);
                const recordId = `daily_ai_${cid}_${today}`;
                return pool.query(
                  `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
                   VALUES ($1, 'DailyAIUsage', $2, $3, NOW(), NOW())
                   ON CONFLICT (id) DO UPDATE
                   SET data = jsonb_set(
                     COALESCE(generic_entities.data::jsonb, '{}'::jsonb),
                     '{count}',
                     (COALESCE((generic_entities.data->>'count')::int, 0) + 1)::text::jsonb
                   ), updated_date = NOW()`,
                  [recordId, cid, JSON.stringify({ count: 1, date: today })]
                );
              }).catch(() => {});
              logLLMUsage(cid).catch(() => {});
            }
          } catch (err) {
            console.error('[Integrations] InvokeLLM error:', err.message);
            const timedOut = /aborted due to timeout|timeout/i.test(err.message || '');
            sendJson(res, {
              error: timedOut
                ? 'Document analysis timed out. Please try a smaller PDF or try again shortly.'
                : err.message,
              retryable: !timedOut,
            }, timedOut ? 504 : 500);
          }
          return;
        }

        if (req.url === '/api/integrations/send-email' && req.method === 'POST') {
          let composeAudit = null;
          let trackingDegraded = false;
          try {
            const caller = await getAuthenticatedUserFromRequest(req);
            if (!caller?.email) {
              sendJson(res, { error: 'Authentication required' }, 401);
              return;
            }
            if (caller.isImpersonating) {
              sendJson(res, { error: 'Sending email is blocked during an impersonation session' }, 403);
              return;
            }
            // The browser may request its current active/impersonated company
            // through the standard tenant header. It is only a requested scope:
            // membership is checked below before it affects any email state.
            const companyId = req.headers?.['x-company-id'] || caller.companyId;
            if (!companyId) {
              sendJson(res, { error: 'No company is selected' }, 403);
              return;
            }
            const pool = await getLLMPool();
            const membership = await pool.query(
              `SELECT company_name, name FROM companies c WHERE c.id = $2 AND (
                LOWER(COALESCE(c.created_by, '')) = LOWER($1) OR EXISTS (
                  SELECT 1 FROM staff_profiles sp WHERE sp.company_id = c.id
                    AND LOWER(COALESCE(NULLIF(sp.user_email, ''), sp.email)) = LOWER($1)
                    AND COALESCE(sp.is_active, true) = true
                )) LIMIT 1`,
              [caller.email, companyId],
            );
            if (!membership.rowCount) {
              sendJson(res, { error: 'You do not have access to send email for this company' }, 403);
              return;
            }
            const body = await parseJsonBody(req);
            const { to, subject, body: emailBody, html, cc, replyTo, contactName } = body;

            const emailTransport = nodeRequire('./lib/emailTransport.cjs');
            if (!to || !subject) {
              sendJson(res, { error: 'to and subject are required' }, 400);
              return;
            }
            const staffRecipients = Array.isArray(to) ? to : [to];
            const manualSend = nodeRequire('./lib/manualSendPolicy.cjs').isAuthenticatedManualSend(
              { manualSend: body.manualSend, __externalCall: true }, req, caller,
            );
            if (staffRecipients.length === 1 && !manualSend) {
              const staffQuietHours = await nodeRequire('./lib/notificationQuietHours.cjs')
                .getStaffNotificationQuietHours(pool, companyId, { email: staffRecipients[0] });
              if (staffQuietHours.active) {
                sendJson(res, {
                  success: false, skipped: true, reason: 'company_notification_quiet_hours',
                  deferred_until: staffQuietHours.deferredUntil,
                });
                return;
              }
            }
            const companyName = String(membership.rows[0]?.company_name || membership.rows[0]?.name || 'CompanySync')
              .replace(/[<>"\r\n]/g, '').trim() || 'CompanySync';
            const configuredFrom = process.env.EMAIL_FROM || 'CompanySync <noreply@companysync.io>';
            const senderAddress = (configuredFrom.match(/<([^>]+)>/) || [null, configuredFrom])[1];
            // Persisted BEFORE the send and echoed back by the provider on
            // every delivery callback, so the outcome stays matchable even if
            // the provider's own message id never reaches the database.
            const correlationId = randomUUID();
            composeAudit = {
              id: randomUUID(), companyId, actorEmail: caller.email, to, contactName,
              subject, body: emailBody || html || '', cc, replyTo, correlationId,
            };
            const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean).join(', ');
            await pool.query(
              `INSERT INTO communications
                (id, company_id, type, communication_type, direction, contact_name,
                 contact_email, subject, body, message, status, created_by, data, created_at, updated_at)
               VALUES ($1, $2, 'email', 'email', 'outbound', $3, $4, $5, $6, $6, 'pending', $7, $8, NOW(), NOW())`,
              [
                composeAudit.id, companyId,
                String(contactName || recipients.split('@')[0] || 'Email recipient').slice(0, 200),
                recipients, subject, composeAudit.body, caller.email,
                JSON.stringify({
                  source: 'staff_compose', actor_email: caller.email, cc: cc || [], reply_to: replyTo || null,
                  delivery_status: 'pending', delivery_status_at: new Date().toISOString(),
                  delivery_correlation_id: correlationId,
                }),
              ],
            );
            const emailResult = await emailTransport.sendPlatformEmail({
              from: `${companyName} <${senderAddress}>`, to, subject,
              ...(html ? { html } : { text: emailBody || '' }),
              ...(cc ? { cc } : {}), ...(replyTo ? { replyTo } : {}),
              correlationId,
              context: { companyId, actorEmail: caller.email, source: 'staff_compose' },
            });
            try {
              // Identifiers are always written; the acceptance state only while
              // nothing better is recorded. The provider can already have called
              // back (matching the pre-send correlation id) during the send, and
              // that outcome must not be overwritten by this weaker one.
              await nodeRequire('./lib/emailDeliveryWebhook.cjs').finalizeSendRecord({
                communicationId: composeAudit.id,
                status: 'sent',
                always: {
                  source: 'staff_compose', actor_email: caller.email, cc: cc || [], reply_to: replyTo || null,
                  provider: emailResult.provider, provider_message_id: emailResult.id,
                  delivery_correlation_id: correlationId,
                },
                optimistic: { delivery_status: 'submitted', delivery_status_at: new Date().toISOString() },
              }, { pool });
              // A delivery callback can beat this update. Apply anything already
              // waiting on this provider message id instead of losing it.
              await nodeRequire('./lib/emailDeliveryWebhook.cjs')
                .applyPendingDeliveryEvents({ pool, messageId: emailResult.id });
            } catch (auditError) {
              // The mail is already accepted, so this is not a failed send. But
              // the pending audit row on its own is NOT reconcilable: without
              // the provider message id no callback can ever find it. Queue the
              // association for repair instead of dropping it.
              console.error('[Integrations] Could not finalize staff compose audit:', auditError.message);
              const repair = await nodeRequire('./lib/emailDeliveryWebhook.cjs').associateProviderMessage({
                communicationId: composeAudit.id,
                provider: emailResult.provider,
                messageId: emailResult.id,
              }, { pool }).catch(() => ({ ok: false, queued: false }));
              // Even when that repair cannot be queued (the database is down,
              // not just this statement), the pre-send record already carries
              // the correlation id the provider echoes back on its callback.
              if (!repair.ok) trackingDegraded = true;
            }
            sendJson(res, {
              success: true,
              id: emailResult.id,
              provider: emailResult.provider,
              communicationId: composeAudit.id,
              deliveryStatus: 'submitted',
              // The mail was accepted either way; this only says the outcome may
              // need a recovery pass. It must never read as "resend this".
              ...(trackingDegraded ? { deliveryTrackingDegraded: true } : {}),
            });
          } catch (err) {
            if (composeAudit) {
              try {
                const pool = await getLLMPool();
                // Same guard as the success path, and a merge rather than a
                // replace: the pre-send correlation id must survive, since a
                // send that looked like a failure here may still have been
                // accepted and will call back later.
                await nodeRequire('./lib/emailDeliveryWebhook.cjs').finalizeSendRecord({
                  communicationId: composeAudit.id,
                  status: 'failed',
                  always: {
                    source: 'staff_compose', actor_email: composeAudit.actorEmail,
                    cc: composeAudit.cc || [], reply_to: composeAudit.replyTo || null,
                    error: String(err.message || err).slice(0, 500),
                  },
                  optimistic: { delivery_status: 'failed', delivery_status_at: new Date().toISOString() },
                }, { pool });
              } catch (auditError) {
                console.error('[Integrations] Could not record failed staff compose email:', auditError.message);
              }
            }
            console.error('[Integrations] SendEmail error:', err.message);
            const status = err.code?.includes('RATE_LIMIT') ? 429 : err.noRetry ? 400 : 502;
            sendJson(res, { error: err.message || 'Failed to send email. Please try again later.' }, status);
          }
          return;
        }

        next();
      });

      console.log('[Integrations] Core integrations plugin loaded (InvokeLLM, UploadFile, SendEmail)');
    }
  };
}
