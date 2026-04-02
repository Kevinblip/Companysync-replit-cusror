const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const stormFunctions = require('./storm-functions.cjs');

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
if (!fs.existsSync(UPLOADS_DIR)) {
  try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {}
}

const MIME_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.csv': 'text/csv', '.txt': 'text/plain', '.heic': 'image/heic', '.heif': 'image/heif', '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.tif': 'image/tiff' };

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

    // 1. DB first
    try {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const result = await pool.query('SELECT file_data, mime_type FROM file_uploads WHERE id = $1', [fileName]);
      if (result.rows.length > 0) {
        const { file_data, mime_type } = result.rows[0];
        return { base64: file_data.toString('base64'), mimeType: mime_type || mimeType };
      }
    } catch (e) {}

    // 2. Disk fallback — check all candidate locations
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
  const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
    const ALLOWED = new Set(['.jpg','.jpeg','.png','.gif','.webp','.svg','.pdf','.doc','.docx','.xls','.xlsx','.csv','.txt','.heic','.heif','.bmp','.tiff','.tif']);
    const ext = path.extname(filePart.filename).toLowerCase();
    if (!ALLOWED.has(ext)) { sendJson(res, { error: `File type "${ext}" not allowed` }, 400); return; }
    const uniqueName = `${randomUUID()}${ext}`;
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    // Save to disk — write to both UPLOADS_DIR and public/ root so the file
    // survives across paths (Vite copies public/* → dist/* at build time)
    const publicRoot = path.join(process.cwd(), 'public');
    const savePaths = [path.join(UPLOADS_DIR, uniqueName), path.join(publicRoot, uniqueName)];
    for (const savePath of savePaths) {
      try {
        const dir = path.dirname(savePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(savePath, filePart.data);
      } catch (e) {}
    }

    // Save to database for persistence across deployments
    try {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      await pool.query(
        `INSERT INTO file_uploads (id, original_filename, mime_type, file_size, file_data) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [uniqueName, filePart.filename, mimeType, filePart.data.length, filePart.data]
      );
    } catch (dbErr) {
      console.warn('[Integrations] DB save failed (file still on disk):', dbErr.message);
    }

    // Always use getcompanysync.com as the host for stored URLs
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const xHost = req.headers['x-forwarded-host'] || req.headers['host'] || '';
    const host = (xHost && xHost.includes('getcompanysync.com')) ? 'getcompanysync.com' : (xHost || 'getcompanysync.com');
    sendJson(res, { file_url: `${protocol}://${host}/uploads/${uniqueName}`, file_name: filePart.filename, size: filePart.data.length });
  } catch (err) {
    console.error('[Integrations] Upload error:', err.message);
    sendJson(res, { error: err.message }, 500);
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
          const plan = await prodDb.getCompanyPlan(cid);
          if (plan === 'trial') {
            const used = await prodDb.getDailyAIUsage(cid);
            if (cid !== 'companysync_master_001' && used >= TRIAL_DAILY_AI_LIMIT) {
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
          console.warn('[DailyAI] Limit check failed (non-fatal):', e.message);
        }
      }
    }

    if (!apiKey) { sendJson(res, { error: 'GOOGLE_GEMINI_API_KEY not configured' }, 500); return; }
    if (!prompt) { sendJson(res, { error: 'prompt is required' }, 400); return; }

    const result = await callGeminiWithSchema(apiKey, prompt, { fileUrls: file_urls || [], responseJsonSchema: response_json_schema, model: model || 'gemini-2.5-flash' });

    if (cid && cid !== 'companysync_master_001' && usingPlatformKey) {
      prodDb.incrementDailyAIUsage(cid).catch(() => {});
    }

    sendJson(res, { response: result });
  } catch (err) {
    console.error('[Integrations] InvokeLLM error:', err.message);
    sendJson(res, { error: err.message }, 500);
  }
}

async function sendEmailWithData(emailData, companyIdHint) {
  const { to, subject, body: emailBody, from, html, companyId, attachments } = emailData;
  if (!to || !subject) throw new Error('to and subject are required');

  const prodDb = require('./prod-db.cjs');
  const nodemailer = require('nodemailer');
  const cid = companyId || companyIdHint;
  const defaultFrom = process.env.EMAIL_FROM || `CompanySync <${process.env.SMTP_USER || 'io.companysync@gmail.com'}>`;
  const toStr = Array.isArray(to) ? to.join(', ') : to;

  // 1. Try company-specific SMTP if configured
  let emailConfig = { type: 'resend', apiKey: process.env.RESEND_API_KEY, isOwn: false };
  try {
    if (cid) emailConfig = await prodDb.getCompanyEmailConfig(cid);
  } catch (e) {}

  if (emailConfig.type === 'smtp') {
    const transport = nodemailer.createTransport({ host: emailConfig.host, port: emailConfig.port, secure: emailConfig.secure, auth: emailConfig.auth });
    const mailOpts = { from: from || emailConfig.from || defaultFrom, to: toStr, subject, ...(html ? { html } : { text: emailBody || '' }) };
    if (attachments && attachments.length > 0) mailOpts.attachments = attachments;
    const info = await transport.sendMail(mailOpts);
    console.log('[Email] Sent via company SMTP:', info.messageId, '→', toStr);
    return { success: true, id: info.messageId };
  }

  // 2. Try global SMTP env vars (Gmail or other configured SMTP)
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const smtpPort = parseInt(process.env.SMTP_PORT || '587');
      const transport = nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpPort === 465, auth: { user: smtpUser, pass: smtpPass }, tls: { rejectUnauthorized: false } });
      const mailOpts = { from: from || defaultFrom, to: toStr, subject, ...(html ? { html } : { text: emailBody || '' }) };
      if (attachments && attachments.length > 0) mailOpts.attachments = attachments;
      const info = await transport.sendMail(mailOpts);
      console.log('[Email] Sent via global SMTP:', info.messageId, '→', toStr);
      return { success: true, id: info.messageId };
    } catch (smtpErr) {
      console.error('[Email] Global SMTP failed, falling back to Resend:', smtpErr.message);
    }
  }

  // 3. Fall back to Resend
  const resendApiKey = emailConfig.apiKey || process.env.RESEND_API_KEY;
  if (!resendApiKey) throw new Error('No email provider configured (SMTP_HOST or RESEND_API_KEY required)');
  const emailPayload = { from: from || defaultFrom, to: Array.isArray(to) ? to : [to], subject, ...(html ? { html } : { text: emailBody || '' }) };
  if (attachments && attachments.length > 0) emailPayload.attachments = attachments.map(a => ({ filename: a.filename, content: a.content }));
  const emailResp = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` }, body: JSON.stringify(emailPayload) });
  const emailResult = await emailResp.json();
  if (!emailResp.ok) throw new Error(emailResult.message || 'Email send failed');
  console.log('[Email] Sent via Resend:', emailResult.id, '→', toStr);
  return { success: true, id: emailResult.id };
}

async function handleSendEstimateEmail(params, req) {
  const prodDb = require('./prod-db.cjs');
  const pool = prodDb.getPool();

  let { to, estimateData, customerName, emailType, note, adjusterName, claimNumber, companyId, pdfBase64, format } = params || {};
  emailType = emailType || 'customer';

  // If only estimateId provided, look up estimate from DB
  if (!to && params.estimateId) {
    const estRes = await pool.query(
      `SELECT * FROM generic_entities WHERE entity_type = 'Estimate' AND id = $1 LIMIT 1`,
      [params.estimateId]
    );
    if (estRes.rows.length === 0) throw new Error('Estimate not found');
    const estRow = estRes.rows[0];
    const est = typeof estRow.data === 'string' ? JSON.parse(estRow.data) : (estRow.data || {});
    companyId = companyId || estRow.company_id;
    to = est.customer_email;
    customerName = est.customer_name || customerName;
    estimateData = {
      estimate_number: est.estimate_number || 'N/A',
      estimate_title: est.estimate_title || est.title || 'Estimate',
      line_items: est.line_items || [],
      total_rcv: est.total_rcv || est.amount || 0,
      total_acv: est.total_acv || 0,
      property_address: est.property_address || '',
      claim_number: est.claim_number || '',
      insurance_company: est.insurance_company || '',
      notes: est.notes || '',
    };
  }

  if (!to) throw new Error('No recipient email address — estimate is missing customer_email');

  // Load company info for branding
  let companyName = 'Your Roofing Company';
  let companyPhone = '';
  let companyEmail = '';
  if (companyId) {
    try {
      const compRes = await pool.query(`SELECT name, phone, email, billing_email FROM companies WHERE id = $1 LIMIT 1`, [companyId]);
      if (compRes.rows.length > 0) {
        const c = compRes.rows[0];
        companyName = c.name || companyName;
        companyPhone = c.phone || '';
        companyEmail = c.email || c.billing_email || '';
      }
    } catch (e) {}
  }

  const fmt = (val) => `$${Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lineItems = estimateData?.line_items || [];
  const totalRcv = estimateData?.total_rcv ?? lineItems.reduce((a, i) => a + (Number(i.rcv) || 0), 0);
  const totalAcv = estimateData?.total_acv ?? lineItems.reduce((a, i) => a + (Number(i.acv) || 0), 0);
  const estNumber = estimateData?.estimate_number || 'N/A';

  // Build subject
  let subject;
  if (emailType === 'production_approval') {
    subject = `Production Approval Request — Estimate #${estNumber} (${customerName || 'Customer'})`;
  } else if (emailType === 'insurance_adjuster') {
    subject = `Roofing Estimate for Claim ${claimNumber || estimateData?.claim_number || 'N/A'} — #${estNumber}`;
  } else {
    subject = `Your Roofing Estimate #${estNumber} from ${companyName}`;
  }

  // Line items table HTML
  const lineItemsHtml = lineItems.length > 0 ? `
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
      <thead>
        <tr style="background:#f3f4f6">
          <th style="text-align:left;padding:8px 10px;border:1px solid #e5e7eb">Description</th>
          <th style="text-align:right;padding:8px 10px;border:1px solid #e5e7eb;white-space:nowrap">RCV</th>
          <th style="text-align:right;padding:8px 10px;border:1px solid #e5e7eb;white-space:nowrap">ACV</th>
        </tr>
      </thead>
      <tbody>
        ${lineItems.map(item => `
          <tr>
            <td style="padding:8px 10px;border:1px solid #e5e7eb">${item.description || item.name || ''}</td>
            <td style="text-align:right;padding:8px 10px;border:1px solid #e5e7eb">${fmt(item.rcv)}</td>
            <td style="text-align:right;padding:8px 10px;border:1px solid #e5e7eb">${fmt(item.acv)}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr style="background:#f9fafb;font-weight:bold">
          <td style="padding:8px 10px;border:1px solid #e5e7eb">Total</td>
          <td style="text-align:right;padding:8px 10px;border:1px solid #e5e7eb">${fmt(totalRcv)}</td>
          <td style="text-align:right;padding:8px 10px;border:1px solid #e5e7eb">${fmt(totalAcv)}</td>
        </tr>
      </tfoot>
    </table>` : `<p style="color:#6b7280;font-style:italic">No line items provided.</p>`;

  // Build body by email type
  let bodyContent;
  if (emailType === 'production_approval') {
    bodyContent = `
      <p>A new estimate has been submitted for production approval.</p>
      <table style="font-size:14px;border-spacing:0">
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Estimate #</td><td style="padding:4px 0"><strong>${estNumber}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Customer</td><td style="padding:4px 0"><strong>${customerName || 'N/A'}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Total RCV</td><td style="padding:4px 0"><strong>${fmt(totalRcv)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Total ACV</td><td style="padding:4px 0"><strong>${fmt(totalAcv)}</strong></td></tr>
      </table>
      ${note ? `<p style="margin-top:12px"><strong>Note:</strong> ${note}</p>` : ''}
      ${lineItemsHtml}`;
  } else if (emailType === 'insurance_adjuster') {
    bodyContent = `
      <p>Dear ${adjusterName || customerName || 'Adjuster'},</p>
      <p>Please find the roofing estimate details below for your review.</p>
      <table style="font-size:14px;border-spacing:0">
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Insured</td><td style="padding:4px 0"><strong>${estimateData?.insured_name || customerName || 'N/A'}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Property</td><td style="padding:4px 0"><strong>${estimateData?.property_address || 'N/A'}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Claim #</td><td style="padding:4px 0"><strong>${claimNumber || estimateData?.claim_number || 'N/A'}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Estimate #</td><td style="padding:4px 0"><strong>${estNumber}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Total RCV</td><td style="padding:4px 0"><strong>${fmt(totalRcv)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Total ACV</td><td style="padding:4px 0"><strong>${fmt(totalAcv)}</strong></td></tr>
      </table>
      ${note ? `<p style="margin-top:12px"><strong>Note:</strong> ${note}</p>` : ''}
      ${lineItemsHtml}`;
  } else {
    bodyContent = `
      <p>Dear ${customerName || 'Valued Customer'},</p>
      <p>Thank you for choosing <strong>${companyName}</strong>. Please find your roofing estimate details below.</p>
      <table style="font-size:14px;border-spacing:0;margin-bottom:8px">
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Estimate #</td><td style="padding:4px 0"><strong>${estNumber}</strong></td></tr>
        ${estimateData?.property_address ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Property</td><td style="padding:4px 0"><strong>${estimateData.property_address}</strong></td></tr>` : ''}
        ${estimateData?.claim_number ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Claim #</td><td style="padding:4px 0"><strong>${estimateData.claim_number}</strong></td></tr>` : ''}
        ${estimateData?.insurance_company ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Insurance</td><td style="padding:4px 0"><strong>${estimateData.insurance_company}</strong></td></tr>` : ''}
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Total RCV</td><td style="padding:4px 0"><strong>${fmt(totalRcv)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Total ACV</td><td style="padding:4px 0"><strong>${fmt(totalAcv)}</strong></td></tr>
      </table>
      ${lineItemsHtml}
      ${estimateData?.notes ? `<p><strong>Notes:</strong> ${estimateData.notes}</p>` : ''}
      <p>If you have any questions, please don't hesitate to contact us.</p>
      ${companyPhone || companyEmail ? `<p style="color:#374151">${companyPhone ? `<strong>Phone:</strong> ${companyPhone}` : ''}${companyPhone && companyEmail ? ' &nbsp;|&nbsp; ' : ''}${companyEmail ? `<strong>Email:</strong> ${companyEmail}` : ''}</p>` : ''}`;
  }

  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px">
    <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);border-radius:12px 12px 0 0;padding:24px;text-align:center">
      <h1 style="color:white;margin:0;font-size:22px">${companyName}</h1>
      <p style="color:#bfdbfe;margin:6px 0 0;font-size:14px">Estimate #${estNumber}</p>
    </div>
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px">
      ${bodyContent}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
      <p style="color:#9ca3af;font-size:12px;margin:0;text-align:center">Powered by CompanySync &mdash; Professional Roofing Solutions</p>
    </div>
  </div>`;

  // Attach PDF if provided
  const attachments = [];
  if (pdfBase64) {
    attachments.push({ filename: `Estimate-${estNumber}.pdf`, content: pdfBase64, encoding: 'base64' });
  }

  const companyIdHint = companyId || req?.headers?.['x-company-id'];
  console.log(`[EstimateEmail] Sending to=${to}, subject="${subject}", type=${emailType}, hasAttachment=${attachments.length > 0}`);
  return sendEmailWithData({ to, subject, html, companyId, attachments }, companyIdHint);
}

async function handleSendEmail(req, res) {
  try {
    const body = await readJsonBody(req);
    const result = await sendEmailWithData(body, req.headers?.['x-company-id']);
    sendJson(res, result);
  } catch (err) {
    console.error('[Integrations] SendEmail error:', err.message);
    sendJson(res, { error: err.message }, 500);
  }
}

async function handleFunctionInvoke(req, res) {
  try {
    const body = await readJsonBody(req);
    const { functionName, params } = body;
    if (!functionName) { sendJson(res, { error: 'functionName is required' }, 400); return; }
    console.log(`[Functions] Invoke: ${functionName}`);

    if (functionName === 'sarahBridgeAPI') {
      const result = await handleSarahBridgeAPI(params, req);
      sendJson(res, { data: result });
      return;
    }

    if (functionName === 'lexiChat') {
      const result = await handleLexiChat(params, req);
      sendJson(res, { data: result });
      return;
    }

    if (functionName === 'sendTaskUpdateToCustomer') {
      const result = await handleSendTaskUpdateToCustomer(params);
      sendJson(res, { data: result });
      return;
    }

    if (functionName === 'sendEstimateEmail') {
      try {
        const result = await handleSendEstimateEmail(params || {}, req);
        sendJson(res, { data: result });
      } catch (emailErr) {
        console.error('[Functions] sendEstimateEmail error:', emailErr.message);
        sendJson(res, { error: emailErr.message }, 500);
      }
      return;
    }

    if (functionName === 'sendTaskEmail' || functionName === 'sendInvoiceEmail' || functionName === 'sendEmailFromCRM') {
      try {
        const result = await sendEmailWithData(params || {}, req.headers?.['x-company-id']);
        sendJson(res, { data: result });
      } catch (emailErr) {
        console.error('[Functions] Email send error:', emailErr.message);
        sendJson(res, { error: emailErr.message }, 500);
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

    if (functionName === 'fetchNWSActiveAlerts') {
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const states = params?.states || ['OH'];
      const result = await stormFunctions.fetchNWSActiveAlerts(pool, states);
      sendJson(res, { data: result });
      return;
    }

    if (functionName === 'aiRoofMeasurement' || functionName === 'geminiRoofMeasurement') {
      const result = await handleAIRoofMeasurement(params || {});
      sendJson(res, { data: result });
      return;
    }

    if (functionName === 'analyzeSidingMeasurement') {
      const result = await handleAnalyzeSidingMeasurement(params || {});
      sendJson(res, { data: result });
      return;
    }

    if (functionName === 'saveMeasurementCalibration') {
      const { companyId, address, lat, lng, aiEstimateSqft, confirmedSqft, source = 'EagleView', measurementType = 'siding' } = params || {};
      if (!companyId || !aiEstimateSqft || !confirmedSqft) { sendJson(res, { data: { success: false, error: 'Missing required fields' } }); return; }
      const correctionFactor = Number(confirmedSqft) / Number(aiEstimateSqft);
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const id = `cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const data = JSON.stringify({ address, lat, lng, aiEstimateSqft: Number(aiEstimateSqft), confirmedSqft: Number(confirmedSqft), correctionFactor, source, measurementType, createdAt: new Date().toISOString() });
      await pool.query(`INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'MeasurementCalibration', $2, $3, NOW(), NOW())`, [id, companyId, data]);
      sendJson(res, { data: { success: true, id, correctionFactor } });
      return;
    }

    if (functionName === 'getCompanyCalibrations') {
      const { companyId, measurementType = 'siding', limit = 30 } = params || {};
      if (!companyId) { sendJson(res, { data: { success: true, calibrations: [], avgCorrectionFactor: 1.0 } }); return; }
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      const result = await pool.query(`SELECT id, data FROM generic_entities WHERE entity_type = 'MeasurementCalibration' AND company_id = $1 ORDER BY created_date DESC LIMIT $2`, [companyId, limit]);
      const calibrations = result.rows.map(r => {
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
        return { ...d, id: r.id };
      }).filter(c => !measurementType || c.measurementType === measurementType || !c.measurementType);
      const factors = calibrations.map(c => c.correctionFactor || 1).filter(f => f > 0.3 && f < 3);
      const avgCorrectionFactor = factors.length > 0 ? factors.reduce((a, b) => a + b, 0) / factors.length : 1.0;
      sendJson(res, { data: { success: true, calibrations, avgCorrectionFactor: Math.round(avgCorrectionFactor * 1000) / 1000 } });
      return;
    }

    if (functionName === 'deleteCalibrationRecord') {
      const { id } = params || {};
      if (!id) { sendJson(res, { data: { success: false, error: 'id required' } }); return; }
      const prodDb = require('./prod-db.cjs');
      const pool = prodDb.getPool();
      await pool.query(`DELETE FROM generic_entities WHERE id = $1 AND entity_type = 'MeasurementCalibration'`, [id]);
      sendJson(res, { data: { success: true } });
      return;
    }

    if (functionName === 'getGoogleMapsApiKey') {
      const key = process.env.GOOGLE_MAPS_API_KEY || "AIzaSyD-TEST-KEY-FOR-TRIALS";
      sendJson(res, { data: { key, apiKey: key, api_key: key } });
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
          "SELECT data FROM generic_entities WHERE entity_type = 'AssistantSettings' AND company_id = $1 ORDER BY updated_date DESC LIMIT 1",
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
      const result = await handlers[functionName](params || {}, process.env.GOOGLE_GEMINI_API_KEY, req);
      sendJson(res, { data: result });
      return;
    }

    console.warn(`[Functions] No handler for: ${functionName}`);
    sendJson(res, { data: {}, warning: `Function '${functionName}' not implemented in production` });
  } catch (err) {
    console.error('[Functions] Error:', err.message);
    sendJson(res, { error: err.message }, 500);
  }
}

async function handleAIRoofMeasurement(params) {
  const { latitude, longitude, address } = params;
  const debugLogs = ['[Prod] aiRoofMeasurement started'];
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!latitude || !longitude) {
    return { success: false, error: 'Latitude and longitude are required', debug_logs: debugLogs };
  }

  if (!googleApiKey) {
    return { success: false, error: 'Google Maps API key not configured on this server.', debug_logs: debugLogs };
  }

  debugLogs.push(`Analyzing: ${address || ''} (${latitude}, ${longitude})`);

  const tryFetch = async (quality) => {
    const qs = quality ? `&requiredQuality=${quality}` : '';
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${latitude}&location.longitude=${longitude}${qs}&key=${googleApiKey}`;
    const r = await fetch(url);
    debugLogs.push(`Solar API [${quality || 'ANY'}]: ${r.status}`);
    return r;
  };

  let solarResponse = await tryFetch('HIGH');
  if (!solarResponse.ok) solarResponse = await tryFetch('MEDIUM');
  if (!solarResponse.ok) solarResponse = await tryFetch(null);

  if (!solarResponse.ok) {
    debugLogs.push('Solar API unavailable — returning estimated measurements');
    return {
      success: true, roof_area_sq: 6, roof_area_sqft: 600,
      ridge_lf: 20, hip_lf: 0, valley_lf: 5, rake_lf: 44, eave_lf: 54,
      step_flashing_lf: 10, pitch: '6/12', overall_confidence: 40,
      analysis_notes: `Solar API could not locate building near (${latitude}, ${longitude}). Using estimated measurements. Try Manual Drawing mode for accuracy.`,
      debug_logs: debugLogs, fallback_used: true
    };
  }

  const solarData = await solarResponse.json();
  debugLogs.push('Parsed Solar API response');

  const roofSegments = solarData.solarPotential?.roofSegmentStats || [];
  debugLogs.push(`Found ${roofSegments.length} roof segments`);

  const wholeAreaM2 = solarData.solarPotential?.wholeRoofStats?.areaMeters2 || 0;
  const wholeAreaSqFt = wholeAreaM2 * 10.764;
  let segmentSumM2 = 0;
  roofSegments.forEach(s => { segmentSumM2 += s.stats?.areaMeters2 || 0; });
  const segmentSumSqFt = segmentSumM2 * 10.764;

  const numSegments = roofSegments.length;

  let totalAreaSqFt = 0, areaMethod = '';
  if (segmentSumSqFt > 0 && wholeAreaSqFt > 0) {
    const ratio = segmentSumSqFt / wholeAreaSqFt;
    if (ratio >= 0.85) { totalAreaSqFt = segmentSumSqFt; areaMethod = 'segment_sum'; }
    else if (ratio >= 0.65) { totalAreaSqFt = segmentSumSqFt * 1.05; areaMethod = 'segment_sum +5%'; }
    else { totalAreaSqFt = (segmentSumSqFt + wholeAreaSqFt) / 2; areaMethod = 'average'; }
  } else if (segmentSumSqFt > 0) { totalAreaSqFt = segmentSumSqFt; areaMethod = 'segment_sum'; }
  else if (wholeAreaSqFt > 0) { totalAreaSqFt = wholeAreaSqFt * 0.92; areaMethod = 'wholeRoofStats'; }
  else { totalAreaSqFt = 600; areaMethod = 'fallback'; }

  // Complexity correction: Google Solar API consistently underestimates on complex roofs
  // because segment geometries don't fully account for ridge/hip/valley intersections and
  // penetrations. Calibrated against EagleView for Ohio-area housing stock (typical error 10-16%).
  let complexityCorrection = 1.0;
  if (numSegments >= 13) complexityCorrection = 1.16;
  else if (numSegments >= 10) complexityCorrection = 1.13;
  else if (numSegments >= 7) complexityCorrection = 1.10;
  if (complexityCorrection > 1.0) {
    totalAreaSqFt *= complexityCorrection;
    areaMethod += ` +${Math.round((complexityCorrection - 1) * 100)}% complexity`;
    debugLogs.push(`Applied +${Math.round((complexityCorrection - 1) * 100)}% complexity correction for ${numSegments} segments`);
  }

  const roofAreaSquares = Math.round((totalAreaSqFt / 100) * 100) / 100;
  const sqrtArea = Math.sqrt(totalAreaSqFt);
  let ridgeLf, hipLf, valleyLf, rakeLf, eaveLf, stepFlashingLf, apronFlashingLf;

  if (numSegments > 4) {
    const complexity = Math.log2(numSegments / 4);
    ridgeLf = Math.round(sqrtArea * (0.8 + complexity * 0.6));
    hipLf = Math.round(sqrtArea * (0.1 + complexity * 0.15));
    valleyLf = Math.round(sqrtArea * (0.3 + complexity * 1.0));
    rakeLf = Math.round(sqrtArea * (1.5 + complexity * 1.2));
    eaveLf = Math.round(sqrtArea * (2.0 + complexity * 0.65));
    stepFlashingLf = Math.round(sqrtArea * (0.3 + complexity * 0.45));
    apronFlashingLf = Math.round(sqrtArea * (0.2 + complexity * 0.5));
  } else {
    ridgeLf = Math.round(sqrtArea * 0.7);
    hipLf = 0; valleyLf = 0;
    rakeLf = Math.round(sqrtArea * 1.4);
    eaveLf = Math.round(sqrtArea * 2.0);
    stepFlashingLf = Math.round(sqrtArea * 0.3);
    apronFlashingLf = 0;
  }

  const degToX12 = (deg) => {
    const rise = Math.tan((deg * Math.PI) / 180) * 12;
    return `${Math.min(20, Math.max(1, Math.round(rise)))}/12`;
  };
  let predominantDeg = null, maxSegArea = 0;
  for (const seg of roofSegments) {
    const segDeg = seg.pitchDegrees ?? seg.tiltDegrees ?? null;
    const segArea = seg.stats?.areaMeters2 || 0;
    if (segDeg > 0 && segArea > maxSegArea) { maxSegArea = segArea; predominantDeg = segDeg; }
  }
  const pitchStr = predominantDeg ? degToX12(predominantDeg) : '6/12';
  const isFlatRoof = predominantDeg !== null && predominantDeg <= 9.5;
  const hasGoodData = segmentSumSqFt > 0 && roofSegments.length >= 2;

  debugLogs.push(`Done — area: ${totalAreaSqFt.toFixed(0)} sqft | method: ${areaMethod} | pitch: ${pitchStr}`);

  return {
    success: true,
    roof_area_sq: roofAreaSquares,
    roof_area_sqft: totalAreaSqFt,
    ridge_lf: ridgeLf, hip_lf: hipLf, valley_lf: valleyLf,
    rake_lf: rakeLf, eave_lf: eaveLf, step_flashing_lf: stepFlashingLf,
    apron_flashing_lf: apronFlashingLf,
    pitch: pitchStr, is_flat_roof: isFlatRoof,
    num_segments: roofSegments.length,
    segment_sum_sqft: Math.round(segmentSumSqFt),
    whole_roof_sqft: Math.round(wholeAreaSqFt),
    area_method: areaMethod,
    overall_confidence: hasGoodData ? 85 : 75,
    ridge_confidence: hasGoodData ? 82 : 72,
    hip_confidence: hasGoodData ? 85 : 75,
    valley_confidence: hasGoodData ? 78 : 68,
    rake_confidence: hasGoodData ? 82 : 72,
    eave_confidence: hasGoodData ? 82 : 72,
    step_flashing_confidence: hasGoodData ? 75 : 65,
    apron_flashing_confidence: hasGoodData ? 70 : 60,
    analysis_notes: `${roofSegments.length} segments detected. Area method: ${areaMethod}.`,
    debug_logs: debugLogs
  };
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
    return { success: true, message: 'Sarah Voice enabled' };
  }

  if (action === 'disableSarahVoice') {
    await pool.query(
      `UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{sarah_voice_enabled}', 'false'), updated_date = NOW() 
       WHERE entity_type = 'TwilioConfig' AND company_id = $1`,
      [companyId]
    );
    return { success: true, message: 'Sarah Voice disabled' };
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
        const resendKey = process.env.RESEND_API_KEY;
        if (resendKey) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: `${effectiveCompanyName} <noreply@getcompanysync.com>`, to: [customer.email], subject: `Project Update: ${effectiveTaskName}`, html: emailHtml })
          });
          results.emails_sent++;
        }
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
          const resendKey = process.env.RESEND_API_KEY;
          if (resendKey) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ from: `${effectiveCompanyName} <noreply@getcompanysync.com>`, to: [staff.user_email], subject: `Task Update: ${effectiveTaskName} (${customer.name})`, html: `<h3>Task Update: ${effectiveTaskName}</h3><p><strong>Customer:</strong> ${customer.name}</p><p><strong>Update:</strong> ${updateText}</p><p><strong>By:</strong> ${updatedBy || 'Team Member'}</p>${appUrl ? `<p><a href="${appUrl}/tasks">View Task</a></p>` : ''}` })
            });
            results.emails_sent++;
          }
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

async function handleLexiChat(params, req) {
  let apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  try {
    const prodDb = require('./prod-db.cjs');
    if (params.companyId) {
      const companyKey = await prodDb.getCompanyGeminiKey(params.companyId);
      if (companyKey) apiKey = companyKey;
    }
  } catch (e) {}
  if (!apiKey) return { response: "AI service is not configured. Please add Google Gemini API key.", error: 'No API key' };

  const { message, conversationHistory = [], companyId, userEmail, userName } = params;
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

    let loggedInEmail = userEmail || null;
    try {
      const prodAuth = require('./prod-auth.cjs');
      const session = await prodAuth.getSessionFromRequest(req, pool);
      const sessionEmail = session?.data?.passport?.user?.claims?.email;
      if (sessionEmail) loggedInEmail = sessionEmail.toLowerCase();
    } catch (e) {}

    let userProfile = null;
    if (loggedInEmail) {
      const spRes = await pool.query('SELECT * FROM staff_profiles WHERE user_email = $1 AND company_id = $2 LIMIT 1', [loggedInEmail, actualCompanyId]);
      userProfile = spRes.rows[0] || null;
      if (!userProfile) {
        const spRes2 = await pool.query('SELECT * FROM staff_profiles WHERE user_email = $1 LIMIT 1', [loggedInEmail]);
        userProfile = spRes2.rows[0] || null;
      }
    }
    if (!userProfile) {
      const staffRes = await pool.query('SELECT * FROM staff_profiles WHERE company_id = $1 AND user_email = $2 LIMIT 1', [actualCompanyId, loggedInEmail || '']);
      userProfile = staffRes.rows[0] || null;
    }

    const effectiveEmail = loggedInEmail || userProfile?.user_email || 'user@company.com';
    const effectiveName = userProfile?.full_name || userName || 'User';
    const isAdmin = userProfile?.is_administrator || userProfile?.is_super_admin || true;

    const custRes = await pool.query('SELECT name, email, phone FROM customers WHERE company_id = $1 ORDER BY created_at DESC LIMIT 50', [actualCompanyId]);
    if (custRes.rows.length > 0) {
      customerList = custRes.rows.map(c => `${c.name} (${c.email || c.phone || 'no contact'})`).join(', ');
    }

    try {
      const memRes = await pool.query(
        "SELECT data FROM generic_entities WHERE entity_type = 'AIMemory' AND (data->>'company_id') = $1 AND (data->>'is_active')::boolean = true ORDER BY (data->>'importance')::int DESC NULLS LAST LIMIT 100",
        [String(actualCompanyId)]
      );
      if (memRes.rows.length > 0) {
        knowledgeBase = '\n\nCOMPANY KNOWLEDGE BASE:\n' + memRes.rows.map(r => `- ${r.data.title}: ${r.data.content}`).join('\n');
      }
    } catch (e) {}

    const now = new Date();
    const userTimeZone = 'America/New_York';
    const currentDateString = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: userTimeZone });
    const todayISO = now.toISOString().split('T')[0];
    const currentTime = now.toLocaleString('en-US', { timeZone: userTimeZone });

    const systemPrompt = `You are Lexi, a powerful AI assistant for ${company?.company_name || 'the company'}. You can do almost ANYTHING within the CRM.

USER: ${effectiveName} (${effectiveEmail}), ${isAdmin ? 'Administrator' : 'Staff Member'}
COMPANY: ${company?.company_name || 'Unknown'}
CUSTOMERS: ${customerList}${knowledgeBase}

COMMUNICATION STYLE:
- Speak conversationally and naturally, like a helpful colleague
- Be proactive — if someone says "remind me to call John tomorrow," just create the event/task immediately
- Summarize instead of reading raw data
- Keep responses concise and friendly
- Confirm what you did after each action

YOUR FULL CAPABILITIES (use tools for ALL of these):
- Calendar: Create events, look up upcoming events for any date range, set reminders, schedule inspections, appointments, meetings, calls
- Tasks: Create tasks with due dates, priorities, and descriptions
- Leads & Customers: Create new leads/customers with full contact info
- Inspections: Schedule roof inspections with crew assignments, create calendar events and leads automatically
- Email & SMS: Compose and send emails or text messages to contacts
- CRM Data: Look up counts and details for customers, leads, estimates, invoices, tasks, projects, payments, staff, calendar events
- Generic CRUD: Create, update, delete, or list ANY entity type in the CRM (estimates, invoices, projects, communications, etc.)

DATE: ${currentDateString}
TIME: ${currentTime}
TIMEZONE: ${userTimeZone}
TODAY: ${todayISO}

TOOL USAGE RULES:
- When asked about calendar/schedule, use get_calendar_events to look up existing events first.
- When asked to add/create/schedule anything, use the appropriate create tool immediately. Don't ask if they want you to — just do it.
- When asked to "remind me" about something, create a calendar event or task with the right date/time.
- When asked about CRM data (how many leads, invoices, etc.), use get_crm_data.
- For inspections, use assign_inspection which can also create calendar events and leads.
- For anything not covered by a specific tool, use manage_entity to create/update/delete/list any entity.
- NEVER say "I can't do that" for CRM operations — you have full access. Use your tools.`;

    const tools = [
      { name: 'get_crm_data', description: 'Get counts and details from CRM - customers, leads, estimates, invoices, tasks, projects, payments, staff, calendar_events', parameters: { type: 'object', properties: { data_type: { type: 'string', enum: ['customers', 'leads', 'estimates', 'invoices', 'tasks', 'projects', 'payments', 'staff', 'calendar_events'] } }, required: ['data_type'] } },
      { name: 'create_calendar_event', description: 'Create a calendar event. Extract title, date/time. Use ISO format.', parameters: { type: 'object', properties: { title: { type: 'string' }, start_time: { type: 'string', description: 'ISO datetime' }, end_time: { type: 'string' }, location: { type: 'string' }, description: { type: 'string' }, event_type: { type: 'string', enum: ['meeting', 'appointment', 'call', 'inspection', 'other'] } }, required: ['title', 'start_time'] } },
      { name: 'create_task', description: 'Create a new task', parameters: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, due_date: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high'] } }, required: ['name'] } },
      { name: 'create_lead', description: 'Create a new lead with name, phone, email, address', parameters: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, street: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' }, zip: { type: 'string' }, notes: { type: 'string' } }, required: ['name'] } },
      { name: 'create_customer', description: 'Create a new customer', parameters: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, street: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' }, zip: { type: 'string' } }, required: ['name'] } },
      { name: 'send_email', description: 'Send an email', parameters: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, message: { type: 'string' } }, required: ['to', 'subject', 'message'] } },
      { name: 'send_sms', description: 'Send a text message', parameters: { type: 'object', properties: { to: { type: 'string' }, message: { type: 'string' } }, required: ['to', 'message'] } },
      { name: 'get_calendar_events', description: 'Get calendar events for a date range. Use this to check what is scheduled, look up upcoming appointments, or find availability.', parameters: { type: 'object', properties: { start_date: { type: 'string', description: 'Start date YYYY-MM-DD' }, end_date: { type: 'string', description: 'End date YYYY-MM-DD' } }, required: ['start_date'] } },
      { name: 'manage_entity', description: 'Create, update, delete, or list ANY CRM entity type. Use for estimates, invoices, projects, communications, workflows, etc.', parameters: { type: 'object', properties: { entity_action: { type: 'string', enum: ['create', 'update', 'delete', 'list'] }, entity_name: { type: 'string' }, entity_data: { type: 'object' }, entity_id: { type: 'string' } }, required: ['entity_action', 'entity_name'] } },
      { name: 'assign_inspection', description: 'Schedule a roof inspection with crew assignment. Can also create a calendar event and lead.', parameters: { type: 'object', properties: { client_name: { type: 'string' }, client_phone: { type: 'string' }, client_email: { type: 'string' }, property_address: { type: 'string' }, assigned_to_email: { type: 'string' }, inspection_date: { type: 'string' }, inspection_time: { type: 'string' }, damage_type: { type: 'string' }, special_instructions: { type: 'string' }, create_calendar_event: { type: 'boolean' }, create_lead: { type: 'boolean' } }, required: ['client_name', 'property_address', 'assigned_to_email'] } }
    ];

    const geminiTools = [{ functionDeclarations: tools }];
    const history = (conversationHistory || []).slice(-10).filter(m => m?.role && m?.content);
    const contents = [];
    for (const msg of history) {
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
    }
    contents.push({ role: 'user', parts: [{ text: message || 'Hello' }] });

    const actionsExecuted = [];
    let finalResponse = '';
    let maxTurns = 5;

    for (let turn = 0; turn < maxTurns; turn++) {
      const geminiBody = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools: geminiTools,
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
      };

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geminiBody) }
      );
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);

      const candidate = data.candidates?.[0];
      if (!candidate) throw new Error('No response from Gemini');

      const parts = candidate.content?.parts || [];
      const textPart = parts.find(p => p.text);
      const functionCallParts = parts.filter(p => p.functionCall);

      if (textPart) finalResponse = textPart.text;
      if (functionCallParts.length === 0) break;

      contents.push({ role: 'model', parts });
      const functionResponseParts = [];

      for (const fc of functionCallParts) {
        const fname = fc.functionCall.name;
        const args = fc.functionCall.args || {};
        console.log(`[Lexi] Tool call: ${fname}`, JSON.stringify(args).substring(0, 200));
        let toolResult = {};

        try {
          if (fname === 'get_crm_data') {
            const tableMap = { customers: 'customers', leads: 'leads', estimates: 'estimates', invoices: 'invoices', tasks: 'tasks', projects: 'projects', payments: 'payments', staff: 'staff_profiles', calendar_events: 'calendar_events' };
            const table = tableMap[args.data_type];
            if (!table) { toolResult = { error: `Unknown data type: ${args.data_type}` }; }
            else {
              const countRes = await pool.query(`SELECT COUNT(*) as count FROM ${table} WHERE company_id = $1`, [actualCompanyId]);
              const sampleRes = await pool.query(`SELECT * FROM ${table} WHERE company_id = $1 ORDER BY created_at DESC NULLS LAST LIMIT 10`, [actualCompanyId]);
              const count = parseInt(countRes.rows[0].count);
              if (args.data_type === 'invoices') {
                const totalRevenue = sampleRes.rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
                toolResult = { count, total_revenue: totalRevenue, sample: sampleRes.rows.slice(0, 5).map(r => ({ number: r.invoice_number, amount: r.amount, status: r.status })) };
              } else if (args.data_type === 'customers') {
                toolResult = { count, sample: sampleRes.rows.map(r => ({ name: r.name, email: r.email, phone: r.phone })) };
              } else if (args.data_type === 'leads') {
                toolResult = { count, sample: sampleRes.rows.map(r => ({ name: r.name, status: r.status, phone: r.phone })) };
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

          } else if (fname === 'create_calendar_event') {
            let endTime = args.end_time;
            if (!endTime && args.start_time) { const d = new Date(args.start_time); d.setHours(d.getHours() + 1); endTime = d.toISOString(); }
            const evId = crypto.randomUUID();
            const evBase44 = `cal_${Date.now()}`;
            const evRes = await pool.query(
              `INSERT INTO calendar_events (id, base44_id, title, start_time, end_time, location, description, event_type, status, company_id, assigned_to, created_by, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9, $10, $10, NOW()) RETURNING id`,
              [evId, evBase44, args.title, args.start_time, endTime, args.location || '', args.description || '', args.event_type || 'meeting', actualCompanyId, effectiveEmail]
            );
            toolResult = { success: true, event_id: evRes.rows[0].id, message: `Event "${args.title}" created` };
            actionsExecuted.push({ tool_name: 'create_event', result: `Created: "${args.title}"` });

          } else if (fname === 'create_task') {
            const taskRes = await pool.query(
              `INSERT INTO tasks (name, description, due_date, priority, status, company_id, assigned_to, created_at)
               VALUES ($1, $2, $3, $4, 'not_started', $5, $6, NOW()) RETURNING id`,
              [args.name, args.description || '', args.due_date || null, args.priority || 'medium', actualCompanyId, effectiveEmail]
            );
            toolResult = { success: true, task_id: taskRes.rows[0].id };
            actionsExecuted.push({ tool_name: 'create_task', result: `Created task: ${args.name}` });

          } else if (fname === 'create_lead') {
            const leadId = crypto.randomUUID();
            const leadRes = await pool.query(
              `INSERT INTO leads (id, name, email, phone, street, city, state, zip, notes, status, lead_source, company_id, assigned_to, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', 'Lexi AI', $10, $11, NOW()) RETURNING id`,
              [leadId, args.name, args.email || '', args.phone || '', args.street || '', args.city || '', args.state || '', args.zip || '', args.notes || '', actualCompanyId, effectiveEmail]
            );
            toolResult = { success: true, lead_id: leadRes.rows[0].id, message: `Lead "${args.name}" created` };
            actionsExecuted.push({ tool_name: 'create_lead', result: `Created lead: ${args.name}` });

          } else if (fname === 'create_customer') {
            const custId = crypto.randomUUID();
            const custInsRes = await pool.query(
              `INSERT INTO customers (id, name, email, phone, street, city, state, zip, company_id, assigned_to, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) RETURNING id`,
              [custId, args.name, args.email || '', args.phone || '', args.street || '', args.city || '', args.state || '', args.zip || '', actualCompanyId, effectiveEmail]
            );
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
               FROM calendar_events WHERE company_id = $1 AND start_time >= $2 AND start_time < $3
               ORDER BY start_time ASC LIMIT 50`,
              [actualCompanyId, startDate, endDatePlusOne.toISOString().split('T')[0]]
            );
            const events = eventsRes.rows.map(e => ({
              id: e.id, title: e.title,
              start: new Date(e.start_time).toLocaleString('en-US', { timeZone: userTimeZone }),
              end: e.end_time ? new Date(e.end_time).toLocaleString('en-US', { timeZone: userTimeZone }) : null,
              location: e.location, type: e.event_type, status: e.status, assigned_to: e.assigned_to
            }));
            toolResult = { count: events.length, events };
            actionsExecuted.push({ tool_name: 'get_calendar_events', result: `Found ${events.length} events` });

          } else if (fname === 'manage_entity') {
            const { entity_action, entity_name, entity_data, entity_id } = args;
            const entityTableMap = { 'Estimate': 'estimates', 'Invoice': 'invoices', 'Project': 'projects', 'Customer': 'customers', 'Lead': 'leads', 'Task': 'tasks', 'CalendarEvent': 'calendar_events', 'StaffProfile': 'staff_profiles', 'Payment': 'payments' };
            const directTable = entityTableMap[entity_name];

            if (entity_action === 'list') {
              if (directTable) {
                const listRes = await pool.query(`SELECT * FROM ${directTable} WHERE company_id = $1 ORDER BY created_at DESC NULLS LAST LIMIT 20`, [actualCompanyId]);
                toolResult = { count: listRes.rows.length, items: listRes.rows.slice(0, 10) };
              } else {
                const listRes = await pool.query(`SELECT id, data FROM generic_entities WHERE entity_type = $1 AND (data->>'company_id') = $2 ORDER BY created_at DESC LIMIT 20`, [entity_name, String(actualCompanyId)]);
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
                toolResult = { success: true, id: createRes.rows[0].id, message: `${entity_name} created` };
              } else {
                const entData = { ...entity_data, company_id: String(actualCompanyId) };
                const createRes = await pool.query(`INSERT INTO generic_entities (entity_type, data, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING id`, [entity_name, JSON.stringify(entData)]);
                toolResult = { success: true, id: createRes.rows[0].id, message: `${entity_name} created` };
              }
              actionsExecuted.push({ tool_name: 'create_entity', result: `Created ${entity_name}` });
            } else if (entity_action === 'update' && entity_id) {
              if (directTable) {
                const keys = Object.keys(entity_data || {});
                if (keys.length > 0) {
                  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
                  await pool.query(`UPDATE ${directTable} SET ${setClauses} WHERE id = $${keys.length + 1} AND company_id = $${keys.length + 2}`, [...Object.values(entity_data), parseInt(entity_id), actualCompanyId]);
                }
                toolResult = { success: true, message: `${entity_name} #${entity_id} updated` };
              } else {
                const existing = await pool.query(`SELECT data FROM generic_entities WHERE id = $1 AND entity_type = $2`, [parseInt(entity_id), entity_name]);
                if (existing.rows.length > 0) {
                  const merged = { ...existing.rows[0].data, ...entity_data };
                  await pool.query(`UPDATE generic_entities SET data = $1, updated_at = NOW() WHERE id = $2`, [JSON.stringify(merged), parseInt(entity_id)]);
                  toolResult = { success: true, message: `${entity_name} #${entity_id} updated` };
                } else {
                  toolResult = { error: `${entity_name} #${entity_id} not found` };
                }
              }
              actionsExecuted.push({ tool_name: 'update_entity', result: `Updated ${entity_name} #${entity_id}` });
            } else if (entity_action === 'delete' && entity_id) {
              if (directTable) {
                await pool.query(`DELETE FROM ${directTable} WHERE id = $1 AND company_id = $2`, [parseInt(entity_id), actualCompanyId]);
              } else {
                await pool.query(`DELETE FROM generic_entities WHERE id = $1 AND entity_type = $2`, [parseInt(entity_id), entity_name]);
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
                toolResult.lead_created = true; 
              } catch (e) {}
            }
          }
        } catch (toolErr) {
          console.error(`[Lexi] Tool ${fname} error:`, toolErr.message);
          toolResult = { error: toolErr.message };
        }

        functionResponseParts.push({ functionResponse: { name: fname, response: toolResult } });
      }

      contents.push({ role: 'user', parts: functionResponseParts });
    }

    return { response: finalResponse || "I'm here to help! What can I do for you?", actions_executed: actionsExecuted };

  } catch (err) {
    console.error('[Lexi] Chat error:', err.message);
    return { response: "I encountered an error processing your request. Please try again.", error: err.message };
  }
}

async function serveUploadedFile(req, res, pathname) {
  const fileName = decodeURIComponent(pathname.replace('/uploads/', ''));
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = { 'Content-Type': mimeType, 'Cache-Control': 'public, max-age=31536000', 'Access-Control-Allow-Origin': '*' };

  // 1. Try DB first (canonical source of truth)
  try {
    const prodDb = require('./prod-db.cjs');
    const pool = prodDb.getPool();
    const result = await pool.query('SELECT file_data, mime_type FROM file_uploads WHERE id = $1', [fileName]);
    if (result.rows.length > 0) {
      const { file_data, mime_type } = result.rows[0];
      // Write to disk cache for faster subsequent requests
      try {
        if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        fs.writeFileSync(path.join(UPLOADS_DIR, fileName), file_data);
      } catch (e) {}
      res.writeHead(200, { ...headers, 'Content-Type': mime_type || mimeType });
      res.end(file_data);
      return true;
    }
  } catch (e) {
    console.error('[serveUploadedFile] DB lookup error:', e.message);
  }

  // 2. Not in DB — check disk locations: uploads dir, public/ root, dist/ root
  const diskCandidates = [
    path.join(UPLOADS_DIR, fileName),
    path.join(process.cwd(), 'public', 'uploads', fileName),
    path.join(process.cwd(), 'public', fileName),
    path.join(process.cwd(), 'dist', fileName),
    path.join(process.cwd(), fileName),
  ];
  for (const diskPath of diskCandidates) {
    if (fs.existsSync(diskPath) && fs.statSync(diskPath).isFile()) {
      console.log(`[serveUploadedFile] found on disk at ${diskPath}, syncing to DB`);
      const fileData = fs.readFileSync(diskPath);
      // Serve immediately
      res.writeHead(200, headers);
      res.end(fileData);
      // Auto-insert into DB so it's available after future deployments
      try {
        const prodDb = require('./prod-db.cjs');
        const pool = prodDb.getPool();
        await pool.query(
          `INSERT INTO file_uploads (id, original_filename, mime_type, file_size, file_data)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [fileName, fileName, mimeType, fileData.length, fileData]
        );
        console.log(`[serveUploadedFile] synced ${fileName} to DB (${fileData.length} bytes)`);
      } catch (e) {
        console.error('[serveUploadedFile] DB insert error:', e.message);
      }
      return true;
    }
  }

  console.warn(`[serveUploadedFile] not found in DB or on disk: ${fileName}`);
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
}

module.exports = { handleUpload, handleInvokeLLM, handleSendEmail, handleFunctionInvoke, serveUploadedFile, sendJson, executeProdWorkflowAction, sendEmailWithData };
