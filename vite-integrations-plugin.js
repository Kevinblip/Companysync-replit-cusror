import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

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
  return sid;
}

async function getCompanyIdFromRequest(req) {
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
    return userRow.rows[0]?.company_id || null;
  } catch { return null; }
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

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

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

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

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
      server.middlewares.use('/uploads', (req, res, next) => {
        const filePath = path.join(UPLOADS_DIR, decodeURIComponent(req.url.split('?')[0]));
        if (fs.existsSync(filePath)) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
            '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
            '.pdf': 'application/pdf', '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls': 'application/vnd.ms-excel',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.csv': 'text/csv', '.txt': 'text/plain',
          };
          res.writeHead(200, {
            'Content-Type': mimeTypes[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000',
          });
          fs.createReadStream(filePath).pipe(res);
          return;
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
              '.heic', '.heif', '.bmp', '.tiff', '.tif',
            ]);
            const fileExt = path.extname(fileName).toLowerCase();
            if (!ALLOWED_EXTENSIONS.has(fileExt)) {
              sendJson(res, { error: `File type "${fileExt}" not allowed` }, 400);
              return;
            }

            const ext = path.extname(fileName).toLowerCase() || '.bin';
            const uniqueName = `${randomUUID()}${ext}`;
            const filePath = path.join(UPLOADS_DIR, uniqueName);

            fs.writeFileSync(filePath, fileBuffer);

            // Also write to public/ root so the file is accessible without /uploads/ prefix
            try {
              const publicRoot = path.join(__dirname, 'public');
              if (!fs.existsSync(publicRoot)) fs.mkdirSync(publicRoot, { recursive: true });
              fs.writeFileSync(path.join(publicRoot, uniqueName), fileBuffer);
            } catch (e) {}

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
            sendJson(res, { error: err.message }, 500);
          }
          return;
        }

        if (req.url === '/api/integrations/send-email' && req.method === 'POST') {
          try {
            const body = await parseJsonBody(req);
            const { to, subject, body: emailBody, from, html } = body;

            console.log(`[Integrations] SendEmail: to=${to}, subject=${subject}`);

            const resendApiKey = process.env.RESEND_API_KEY;
            if (!resendApiKey) {
              console.error('[Integrations] RESEND_API_KEY not configured!');
              sendJson(res, { error: 'RESEND_API_KEY not configured' }, 500);
              return;
            }

            if (!to || !subject) {
              sendJson(res, { error: 'to and subject are required' }, 400);
              return;
            }

            const emailPayload = {
              from: (from && from !== 'CompanySync <noreply@companysync.com>' && from !== 'CompanySync <noreply@getcompanysync.com>') ? from : (process.env.EMAIL_FROM || 'CompanySync <noreply@resend.dev>'),
              to: Array.isArray(to) ? to : [to],
              subject,
              ...(html ? { html } : { text: emailBody || '' }),
            };

            const emailResp = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${resendApiKey}`,
              },
              body: JSON.stringify(emailPayload),
            });

            const emailResult = await emailResp.json();

            if (!emailResp.ok) {
              console.error('[Integrations] Resend API error:', emailResult);
              logIntegrationActivity('Resend', 'SendEmail', 'error', { error: emailResult.message, meta: { to, subject } });
              sendJson(res, { error: emailResult.message || 'Email send failed' }, emailResp.status);
              return;
            }

            console.log('[Integrations] Email sent successfully:', emailResult.id);
            logIntegrationActivity('Resend', 'SendEmail', 'success', { meta: { to, subject, email_id: emailResult.id } });
            sendJson(res, { success: true, id: emailResult.id });
          } catch (err) {
            console.error('[Integrations] SendEmail error:', err.message);
            logIntegrationActivity('Resend', 'SendEmail', 'error', { error: err.message });
            sendJson(res, { error: err.message }, 500);
          }
          return;
        }

        next();
      });

      console.log('[Integrations] Core integrations plugin loaded (InvokeLLM, UploadFile, SendEmail)');
    }
  };
}
