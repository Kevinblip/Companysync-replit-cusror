import { randomUUID } from 'crypto';
import pg from 'pg';
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

          const template = {
            id: session.template_id,
            template_name: session.template_name,
            fillable_fields: session.fillable_fields || [],
            original_file_url: session.original_file_url,
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

          if (sessionData) {
            console.log('[Signing] Inserting new local signing session...');
            const insertResult = await pool.query(
              `INSERT INTO signing_sessions 
                (base44_session_id, company_id, template_id, template_name, contract_name, 
                 customer_name, customer_email, customer_phone, delivery_method, 
                 rep_name, rep_email, rep_fields, rep_signature_url, rep_signed_at,
                 fillable_fields, original_file_url, signing_token, status, current_signer, expires_at, sent_to_customer_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
               RETURNING *`,
              [
                sessionData.base44_session_id || sessionId,
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
            console.log('[Signing] Local session created, id:', session.id);
          } else {
            const existing = await pool.query('SELECT * FROM signing_sessions WHERE base44_session_id = $1', [sessionId]);
            if (existing.rows.length > 0) {
              await pool.query(
                'UPDATE signing_sessions SET signing_token=$1, status=$2, current_signer=$3, expires_at=$4, sent_to_customer_at=$5, updated_at=$6 WHERE base44_session_id=$7',
                [signingToken, 'awaiting_customer', 'customer', expiresAt, new Date(), new Date(), sessionId]
              );
              session = (await pool.query('SELECT * FROM signing_sessions WHERE base44_session_id = $1', [sessionId])).rows[0];
            } else {
              res.writeHead(404, corsHeaders());
              res.end(JSON.stringify({ success: false, error: 'Session not found. Please provide sessionData when calling this endpoint.' }));
              return;
            }
          }

          const signingLink = `${replitBaseUrl}/sign-contract-customer?token=${signingToken}`;
          console.log('[Signing] Signing link:', signingLink);

          const RESEND_KEY = process.env.RESEND_API_KEY;
          const customerEmail = session.customer_email || '';
          const customerName = session.customer_name || 'Customer';
          const contractName = session.contract_name || '';
          const templateName = session.template_name || '';
          const repName = session.rep_name || '';
          const deliveryMethod = session.delivery_method || 'email';
          const expiresDate = expiresAt.toLocaleDateString();

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
            if (!RESEND_KEY) {
              emailError = 'RESEND_API_KEY not configured';
              console.error('[Signing]', emailError);
            } else {
              console.log('[Signing] Sending email via Resend to:', customerEmail);
              const emailHtml = buildSigningEmailHtml({
                customerName, repName, templateName, contractName,
                signingLink, expiresDate, companyName: '',
              });
              try {
                const emailRes = await fetch('https://api.resend.com/emails', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    from: `Contract Signing <noreply@mycrewcam.com>`,
                    to: [customerEmail],
                    subject: `Contract Ready: ${templateName || contractName || 'Review & Sign'}`,
                    html: emailHtml,
                  }),
                });
                const emailResult = await emailRes.json();
                console.log('[Signing] Email result:', emailRes.ok ? 'SUCCESS' : 'FAILED', JSON.stringify(emailResult));
                emailSent = emailRes.ok;
                if (!emailRes.ok) emailError = emailResult.message || 'Resend API error';
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

          const RESEND_KEY = process.env.RESEND_API_KEY;
          if (RESEND_KEY && session.rep_email) {
            try {
              const notifHtml = buildRepNotificationHtml({
                contractName: session.contract_name,
                templateName: session.template_name,
                customerName: session.customer_name,
                fields,
              });
              await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  from: `Contract Signing <noreply@mycrewcam.com>`,
                  to: [session.rep_email],
                  subject: `Contract Signed: ${session.contract_name || session.template_name} - ${session.customer_name}`,
                  html: notifHtml,
                }),
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
