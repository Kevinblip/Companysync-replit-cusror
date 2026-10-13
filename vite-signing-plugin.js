import { randomUUID } from 'crypto';
import pg from 'pg';
import { createRequire } from 'node:module';
const _signingRequire = createRequire(import.meta.url);
const _emailHealth = _signingRequire('./lib/emailProviderHealth.cjs');

// Postmark rejects From addresses on unverified domains — derive the send
// domain from EMAIL_FROM instead of hardcoding legacy mycrewcam.com.
function signingFromAddr(displayName) {
  const envFrom = process.env.EMAIL_FROM || 'CompanySync <noreply@companysync.io>';
  const addr = envFrom.match(/<([^>]+)>/)?.[1] || envFrom;
  return `${displayName} <${addr}>`;
}

const { Pool } = pg;

const REPLIT_APP_URL = process.env.VITE_REPLIT_APP_URL || '';

let signingPool = null;
function getSigningPool() {
  if (!signingPool) {
    signingPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    signingPool.on('error', (err) => {
      console.error('[Signing DB] Pool error:', err.message);
    });
  }
  return signingPool;
}

// Resolve the contract wording for a signing session.
// Prefers the frozen snapshot (signing_sessions.html_content); for legacy rows without a
// snapshot it falls back to the ContractTemplate entity, then the ContractEditorContent
// silo (company-scoped), and backfills the snapshot so the contract freezes from then on.
async function resolveSessionHtml(pool, s, sessionData) {
  if (s && s.html_content) return s.html_content;
  // Only accept JSON-block content (the format ContractHtmlRenderer expects). Non-JSON
  // (e.g. raw HTML) is rejected so the renderer never silently falls back to the built-in
  // default legal text of the wrong company.
  const isJsonBlocks = (v) => {
    if (typeof v !== 'string' || v.trim()[0] !== '{') return false;
    try { const o = JSON.parse(v); return !!o && typeof o === 'object'; } catch (_) { return false; }
  };
  let snap = null;
  if (sessionData && isJsonBlocks(sessionData.html_content)) snap = sessionData.html_content;
  if (!snap && s && s.template_id) {
    try {
      const tr = await pool.query(
        `SELECT data FROM generic_entities WHERE id = $1 AND entity_type = 'ContractTemplate' AND company_id = $2 LIMIT 1`,
        [s.template_id, s.company_id]
      );
      if (tr.rows.length > 0) {
        const d = typeof tr.rows[0].data === 'string' ? JSON.parse(tr.rows[0].data) : tr.rows[0].data;
        let hc = d && d.html_content;
        if (hc && typeof hc === 'object') hc = JSON.stringify(hc);
        if (isJsonBlocks(hc)) snap = hc;
      }
    } catch (_) {}
  }
  // Legacy contingency wording lives in the company-scoped ContractEditorContent silo.
  // Apply it ONLY to contingency-style templates that are NOT uploaded PDFs, so an uploaded
  // PDF template is never overwritten by another document's text.
  if (!snap && s && !s.original_file_url) {
    const nm = (s.template_name || '').toLowerCase();
    if (nm.includes('contingency')) {
      try {
        const ce = await pool.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'ContractEditorContent' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
          [s.company_id]
        );
        if (ce.rows.length > 0) {
          const d = typeof ce.rows[0].data === 'string' ? JSON.parse(ce.rows[0].data) : ce.rows[0].data;
          let content = d && d.content;
          if (content && typeof content === 'object') content = JSON.stringify(content);
          if (isJsonBlocks(content)) snap = content;
        }
      } catch (_) {}
    }
  }
  if (snap && s && s.id != null) {
    await pool.query(
      `UPDATE signing_sessions SET html_content=$1 WHERE id=$2 AND html_content IS NULL`,
      [snap, s.id]
    ).catch(() => {});
    s.html_content = snap;
  }
  return snap || null;
}

function getReplitBaseUrl(reqHeaders) {
  const host = reqHeaders?.host;
  if (host && host !== 'localhost:5000') {
    const proto = reqHeaders?.['x-forwarded-proto'] || 'https';
    return `${proto}://${host}`;
  }
  if (REPLIT_APP_URL) return REPLIT_APP_URL.replace(/\/$/, '');
  return `https://${host || 'localhost:5000'}`;
}

async function parseBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  return JSON.parse(body);
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };
}

function buildSigningEmailHtml({ customerName, repName, templateName, contractName, signingLink, expiresDate, companyName }) {
  const displayCompany = companyName || 'Contract Signing';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;"><h2 style="color: white; margin: 0 0 5px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px;">${displayCompany}</h2><h1 style="color: white; margin: 0; font-size: 24px;">Contract Ready for Your Signature</h1></div><div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;"><p style="font-size: 16px;">Hello <strong>${customerName}</strong>,</p><p style="font-size: 16px;">${repName ? repName + ' has' : 'You have been'} sent you a contract for electronic signature.</p>${templateName || contractName ? `<div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">${templateName ? `<p style="margin: 5px 0;"><strong>Contract:</strong> ${templateName}</p>` : ''}${contractName ? `<p style="margin: 5px 0;"><strong>Job:</strong> ${contractName}</p>` : ''}<p style="margin: 5px 0;"><strong>Expires:</strong> ${expiresDate}</p></div>` : ''}<p style="text-align: center; margin: 30px 0;"><a href="${signingLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-size: 18px; font-weight: bold;">Review & Sign Contract</a></p><p style="font-size: 14px; color: #666;">This link expires on <strong>${expiresDate}</strong>.</p></div></body></html>`;
}

function buildRepNotificationHtml({ contractName, templateName, customerName, fields }) {
  let fieldRows = '';
  if (fields && Object.keys(fields).length > 0) {
    for (const [key, value] of Object.entries(fields)) {
      fieldRows += `<tr><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: 600;">${key}</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${value}</td></tr>`;
    }
  } else {
    fieldRows = '<tr><td colspan="2" style="padding: 8px; color: #999;">No additional fields filled.</td></tr>';
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); padding: 20px; text-align: center; border-radius: 10px 10px 0 0;"><h1 style="color: white; margin: 0; font-size: 22px;">Contract Signed!</h1></div><div style="background: #f9fafb; padding: 25px; border-radius: 0 0 10px 10px;"><p><strong>Contract:</strong> ${contractName || templateName || 'N/A'}</p><p><strong>Customer:</strong> ${customerName}</p><p><strong>Signed at:</strong> ${new Date().toLocaleString()}</p><h3 style="margin-top: 20px; border-bottom: 2px solid #22c55e; padding-bottom: 5px;">Customer Filled Information</h3><table style="width: 100%; border-collapse: collapse;">${fieldRows}</table><p style="margin-top: 20px; font-size: 14px; color: #666;">The signed contract is available in your CRM under Contracts.</p></div></body></html>`;
}

export default function signingProxyPlugin() {
  return {
    name: 'signing-proxy',
    configureServer(server) {
      console.log('[Signing] Local PostgreSQL signing proxy loaded');

      // ==========================================
      // ENDPOINT 1: GET SIGNING SESSION (PUBLIC - no auth needed)
      // Customer clicks email link → loads contract for signing
      // ==========================================
      server.middlewares.use('/api/public/get-signing-session', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          res.writeHead(405, corsHeaders());
          res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
          return;
        }

        try {
          const body = await parseBody(req);
          const token = body.token || body?.body?.token || body?.data?.token;
          console.log('[Signing] getSigningSession - token:', token);

          if (!token) {
            res.writeHead(400, corsHeaders());
            res.end(JSON.stringify({ success: false, error: 'Token required' }));
            return;
          }

          const pool = getSigningPool();
          const result = await pool.query('SELECT * FROM signing_sessions WHERE signing_token = $1', [token]);

          if (result.rows.length === 0) {
            console.log('[Signing] No session found for token:', token);
            res.writeHead(404, corsHeaders());
            res.end(JSON.stringify({ success: false, error: 'Invalid or expired signing link' }));
            return;
          }

          const session = result.rows[0];
          console.log('[Signing] Found session:', session.contract_name, 'status:', session.status);

          if (session.expires_at && new Date(session.expires_at) < new Date()) {
            res.writeHead(410, corsHeaders());
            res.end(JSON.stringify({ success: false, error: 'This signing link has expired' }));
            return;
          }

          const responseSession = {
            id: session.id,
            base44_session_id: session.base44_session_id,
            company_id: session.company_id,
            template_id: session.template_id,
            template_name: session.template_name,
            contract_name: session.contract_name,
            customer_name: session.customer_name,
            customer_email: session.customer_email,
            delivery_method: session.delivery_method,
            rep_name: session.rep_name,
            rep_email: session.rep_email,
            rep_fields: session.rep_fields || {},
            rep_signature_url: session.rep_signature_url,
            status: session.status,
            current_signer: session.current_signer,
            final_pdf_url: null,
          };

          const htmlContent = await resolveSessionHtml(pool, session, null);
          const template = {
            id: session.template_id,
            template_name: session.template_name,
            fillable_fields: session.fillable_fields || [],
            original_file_url: session.original_file_url,
            html_content: htmlContent,
          };

          res.writeHead(200, corsHeaders());
          res.end(JSON.stringify({ success: true, session: responseSession, template }));
        } catch (error) {
          console.error('[Signing] getSigningSession error:', error.message);
          res.writeHead(500, corsHeaders());
          res.end(JSON.stringify({ success: false, error: 'Server error: ' + error.message }));
        }
      });

      // ==========================================
      // ENDPOINT 2: SEND SIGNING LINK (AUTH required - rep sends contract to customer)
      // Rep signs → clicks send → creates local session + sends email
      // ==========================================
      server.middlewares.use('/api/contracts/send-signing-link', async (req, res) => {
        await _signingRequire('./lib/signingLinkDelivery.cjs').handleSigningLinkDelivery(req, res, {
          pool: getSigningPool(),
        });
        return;
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          res.writeHead(405, corsHeaders());
          res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
          return;
        }

        try {
          const body = await parseBody(req);
          const replitBaseUrl = getReplitBaseUrl(req.headers);
          const sessionId = body.sessionId || body.session_id;
          const sessionData = body.sessionData;

          console.log('[Signing] send-signing-link, sessionId:', sessionId, 'hasSessionData:', !!sessionData);

          if (!sessionId && !sessionData) {
            res.writeHead(400, corsHeaders());
            res.end(JSON.stringify({ success: false, error: 'sessionId or sessionData required' }));
            return;
          }

          const pool = getSigningPool();
          const signingToken = randomUUID();
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

          let session;

          // Determine the base44_session_id to look up
          const lookupId = (sessionData && (sessionData.base44_session_id || sessionId)) || sessionId;

          // Always try to find an existing row first (UPSERT pattern — prevents duplicate rows & broken links).
          // Also match on `id` so entity-create rows (base44_session_id=NULL) are found before a duplicate insert.
          const existing = await pool.query(
            'SELECT * FROM signing_sessions WHERE base44_session_id = $1 OR id::text = $1 ORDER BY id LIMIT 1',
            [lookupId]
          );

          if (existing.rows.length > 0) {
            console.log('[Signing] Existing session found (id:', existing.rows[0].id, '), refreshing token...');
            const existingId = existing.rows[0].id;
            if (sessionData) {
              await pool.query(
                `UPDATE signing_sessions SET signing_token=$1, status=$2, current_signer=$3, expires_at=$4,
                 sent_to_customer_at=$5, updated_at=$6,
                 base44_session_id=COALESCE(base44_session_id, $7),
                 rep_fields=COALESCE($8::jsonb, rep_fields),
                 rep_signature_url=COALESCE($9, rep_signature_url),
                 rep_signed_at=COALESCE($10, rep_signed_at),
                 fillable_fields=COALESCE($11::jsonb, fillable_fields),
                 original_file_url=COALESCE($12, original_file_url)
                 WHERE id=$13`,
                [
                  signingToken, 'awaiting_customer', 'customer', expiresAt, new Date(), new Date(),
                  lookupId,
                  sessionData.rep_fields ? JSON.stringify(sessionData.rep_fields) : null,
                  sessionData.rep_signature_url || null,
                  sessionData.rep_signed_at ? new Date(sessionData.rep_signed_at) : null,
                  sessionData.fillable_fields ? JSON.stringify(sessionData.fillable_fields) : null,
                  sessionData.original_file_url || null,
                  existingId,
                ]
              );
            } else {
              await pool.query(
                'UPDATE signing_sessions SET signing_token=$1, status=$2, current_signer=$3, expires_at=$4, sent_to_customer_at=$5, updated_at=$6, base44_session_id=COALESCE(base44_session_id, $7) WHERE id=$8',
                [signingToken, 'awaiting_customer', 'customer', expiresAt, new Date(), new Date(), lookupId, existingId]
              );
            }
            session = (await pool.query('SELECT * FROM signing_sessions WHERE id = $1', [existingId])).rows[0];
            console.log('[Signing] Token refreshed for session id:', session.id);
          } else if (sessionData) {
            console.log('[Signing] No existing session found, inserting new row...');
            const insertResult = await pool.query(
              `INSERT INTO signing_sessions 
                (base44_session_id, company_id, template_id, template_name, contract_name, 
                 customer_name, customer_email, customer_phone, delivery_method, 
                 rep_name, rep_email, rep_fields, rep_signature_url, rep_signed_at,
                 fillable_fields, original_file_url, signing_token, status, current_signer, expires_at, sent_to_customer_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
               RETURNING *`,
              [
                lookupId,
                sessionData.company_id,
                sessionData.template_id,
                sessionData.template_name,
                sessionData.contract_name,
                sessionData.customer_name,
                sessionData.customer_email,
                sessionData.customer_phone,
                sessionData.delivery_method || 'email',
                sessionData.rep_name,
                sessionData.rep_email,
                JSON.stringify(sessionData.rep_fields || {}),
                sessionData.rep_signature_url,
                sessionData.rep_signed_at ? new Date(sessionData.rep_signed_at) : null,
                JSON.stringify(sessionData.fillable_fields || []),
                sessionData.original_file_url,
                signingToken,
                'awaiting_customer',
                'customer',
                expiresAt,
                new Date(),
              ]
            );
            session = insertResult.rows[0];
            console.log('[Signing] New session inserted, id:', session.id);
          } else {
            res.writeHead(404, corsHeaders());
            res.end(JSON.stringify({ success: false, error: 'Session not found. Please provide sessionData to create a new session.' }));
            return;
          }

          // Freeze the contract wording into the session so later template edits do not
          // change an already-sent contract (legal integrity — the sent doc == signed doc).
          try { await resolveSessionHtml(pool, session, sessionData); } catch (_) {}

          const signingLink = `${replitBaseUrl}/sign-contract-customer?token=${signingToken}`;
          console.log('[Signing] Signing link:', signingLink);

          const emailProvider = _signingRequire('./lib/emailTransport.cjs').activeProvider();
          const customerEmail = session.customer_email || '';
          const customerName = session.customer_name || 'Customer';
          const contractName = session.contract_name || '';
          const templateName = session.template_name || '';
          const repName = session.rep_name || '';
          const deliveryMethod = session.delivery_method || 'email';
          const expiresDate = expiresAt.toLocaleDateString();

          let companyName = '';
          try {
            const coRow = await pool.query('SELECT company_name FROM companies WHERE id = $1 LIMIT 1', [session.company_id]);
            companyName = coRow.rows[0]?.company_name || '';
          } catch (coErr) {
            console.warn('[Signing] Could not fetch company name:', coErr.message);
          }

          let emailSent = false;
          let emailError = null;
          let smsSent = false;
          let smsError = null;

          if (deliveryMethod === 'sms' && session.customer_phone) {
            const twilioSid   = process.env.TWILIO_ACCOUNT_SID;
            const twilioToken = process.env.TWILIO_AUTH_TOKEN;
            const twilioFrom  = process.env.TWILIO_PHONE_NUMBER;
            if (!twilioSid || !twilioToken || !twilioFrom) {
              smsError = 'Twilio not configured';
              console.error('[Signing]', smsError);
            } else {
              const smsBody = `Hi ${customerName},${repName ? ` ${repName} has` : ' You have been'} sent you a contract to review and sign.\n\n${signingLink}\n\nExpires: ${expiresDate}`;
              try {
                const smsRes = await fetch(
                  `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/x-www-form-urlencoded',
                      'Authorization': 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
                    },
                    body: new URLSearchParams({ From: twilioFrom, To: session.customer_phone, Body: smsBody }).toString(),
                  }
                );
                const smsResult = await smsRes.json();
                console.log('[Signing] SMS result:', smsRes.ok ? 'SUCCESS' : 'FAILED', smsResult.sid || smsResult.message);
                smsSent = smsRes.ok;
                if (!smsRes.ok) smsError = smsResult.message || 'Twilio API error';
              } catch (smsErr) {
                console.error('[Signing] SMS error:', smsErr.message);
                smsError = smsErr.message;
              }
            }
          }

          if (deliveryMethod === 'email' && customerEmail && customerEmail.includes('@')) {
            if (emailProvider === 'none') {
              emailError = 'No email provider configured';
              console.error('[Signing]', emailError);
            } else {
              console.log('[Signing] Sending email via Resend to:', customerEmail);
              const emailHtml = buildSigningEmailHtml({
                customerName, repName, templateName, contractName,
                signingLink, expiresDate, companyName,
              });
              try {
                try {
                  const sendRes = await _signingRequire('./lib/emailTransport.cjs').sendPlatformEmail({
                    from: signingFromAddr(companyName || 'Contract Signing'),
                    to: [customerEmail],
                    subject: `Contract Ready: ${templateName || contractName || 'Review & Sign'}`,
                    html: emailHtml,
                  });
                  console.log('[Signing] Email result: SUCCESS', sendRes.id);
                  emailSent = true;
                } catch (sendErr) {
                  console.log('[Signing] Email result: FAILED', sendErr.message);
                  emailSent = false;
                  emailError = sendErr.message || 'Email send error';
                }
              } catch (emailErr) {
                console.error('[Signing] Email error:', emailErr.message);
                emailError = emailErr.message;
              }
            }
          }

          const result = {
            success: true,
            signing_link: signingLink,
            local_session_id: session.id,
            expires_at: expiresAt.toISOString(),
            delivery_method: deliveryMethod,
            email_sent: emailSent,
            sms_sent: smsSent,
            message: deliveryMethod === 'sms'
              ? (smsSent ? `SMS sent to ${session.customer_phone}` : `SMS failed: ${smsError || 'unknown'}`)
              : emailSent ? `Email sent to ${customerEmail}` : `Email not sent: ${emailError || 'unknown'}`,
          };
          if (emailError) result.email_warning = emailError;
          if (smsError) result.sms_warning = smsError;

          res.writeHead(200, corsHeaders());
          res.end(JSON.stringify(result));
        } catch (error) {
          console.error('[Signing] send-signing-link error:', error.message, error.stack);
          res.writeHead(500, corsHeaders());
          res.end(JSON.stringify({ success: false, error: 'Error: ' + error.message }));
        }
      });

      // ==========================================
      // ENDPOINT 3: SIGN CONTRACT (PUBLIC - no auth needed)
      // Customer submits signature + filled fields
      // ==========================================
      server.middlewares.use('/api/public/sign-contract', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          res.writeHead(405, corsHeaders());
          res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
          return;
        }

        try {
          const body = await parseBody(req);
          const token = body.token || body?.body?.token || body?.data?.token;
          const fields = body.fields || body?.body?.fields || body?.data?.fields || {};
          const signature = body.signature || body?.body?.signature || body?.data?.signature;

          console.log('[Signing] signContract - token:', token, 'hasSignature:', !!signature);

          if (!token || !signature) {
            res.writeHead(400, corsHeaders());
            res.end(JSON.stringify({ success: false, error: 'Token and signature required' }));
            return;
          }

          const pool = getSigningPool();
          const result = await pool.query('SELECT * FROM signing_sessions WHERE signing_token = $1', [token]);

          if (result.rows.length === 0) {
            res.writeHead(404, corsHeaders());
            res.end(JSON.stringify({ success: false, error: 'Invalid signing link' }));
            return;
          }

          const session = result.rows[0];

          if (session.status === 'completed') {
            res.writeHead(400, corsHeaders());
            res.end(JSON.stringify({ success: false, error: 'Contract already signed' }));
            return;
          }

          if (session.expires_at && new Date(session.expires_at) < new Date()) {
            res.writeHead(410, corsHeaders());
            res.end(JSON.stringify({ success: false, error: 'This signing link has expired' }));
            return;
          }

          await pool.query(
            `UPDATE signing_sessions SET 
              customer_fields = $1, customer_signature_data = $2, customer_signed_at = $3,
              status = 'completed', completed_at = $4, updated_at = $5
             WHERE id = $6`,
            [JSON.stringify(fields), signature, new Date(), new Date(), new Date(), session.id]
          );
          console.log('[Signing] Session updated to completed, id:', session.id);

          // Propagate completion to sibling/duplicate rows (legacy dedup safety) so the
          // company-scoped E-Sign list always reflects Completed even when a duplicate
          // signing_sessions row exists for the same contract.
          try {
            const nowTs = new Date();
            await pool.query(
              `UPDATE signing_sessions
               SET status='completed',
                   completed_at=COALESCE(completed_at,$1),
                   customer_signed_at=COALESCE(customer_signed_at,$2),
                   customer_fields=$3, customer_signature_data=$4, updated_at=$5
               WHERE id <> $6 AND status NOT IN ('completed','declined')
                 AND (company_id = $7 OR ($7 IS NULL AND company_id IS NULL))
                 AND (
                       id::text = $8
                    OR base44_session_id = $9
                    OR (base44_session_id IS NOT NULL AND base44_session_id = $8)
                 )`,
              [nowTs, nowTs, JSON.stringify(fields), signature, nowTs,
               session.id, session.company_id, session.base44_session_id, String(session.id)]
            );
          } catch (sibErr) {
            console.warn('[Signing] sibling completion propagation failed:', sibErr.message);
          }

          const emailProvider = _signingRequire('./lib/emailTransport.cjs').activeProvider();
          if (emailProvider !== 'none' && session.rep_email) {
            try {
              const notifHtml = buildRepNotificationHtml({
                contractName: session.contract_name,
                templateName: session.template_name,
                customerName: session.customer_name,
                fields,
              });
              await _signingRequire('./lib/emailTransport.cjs').sendPlatformEmail({
                from: signingFromAddr('Contract Signing'),
                to: [session.rep_email],
                subject: `Contract Signed: ${session.contract_name || session.template_name} - ${session.customer_name}`,
                html: notifHtml,
              });
              console.log('[Signing] Rep notification sent to:', session.rep_email);
            } catch (emailErr) {
              console.error('[Signing] Rep notification error:', emailErr.message);
            }
          }

          res.writeHead(200, corsHeaders());
          res.end(JSON.stringify({ success: true, message: 'Contract signed successfully' }));
        } catch (error) {
          console.error('[Signing] signContract error:', error.message, error.stack);
          res.writeHead(500, corsHeaders());
          res.end(JSON.stringify({ success: false, error: 'Server error: ' + error.message }));
        }
      });
    }
  };
}
