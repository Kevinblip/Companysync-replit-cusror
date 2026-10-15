'use strict';

// Shared call-recording pipeline for AI-answered (ws-bridge) and forwarded calls.
// Required by BOTH the dev vite plugins and prod-server.cjs — fix once here,
// never mirror (see replit.md dev/prod lockstep rules).
//
// Responsibilities:
//   - startCallRecording: kick off a dual-channel Twilio call recording via REST
//     (the ws-bridge answers with <Connect><Stream>, which never records on its own).
//   - handleRecordingWebhook: local replacement for the legacy Deno
//     functions/recordingWebhook.ts (which was never wired into these servers and
//     404'd). Verifies the Twilio signature, guards against SSRF, attaches the
//     recording URL to the matching Communication row, and enqueues transcription.
//   - transcribeRecording: local replacement for functions/transcribeRecording.ts.
//     Downloads the recording (Twilio-hosts only) and transcribes with Gemini.

const { verifyTwilioWebhook, shouldRejectTwilio } = require('./twilioSignature.cjs');
const { twilioApiUrl } = require('./twilioApiBase.cjs');

const ALLOWED_RECORDING_HOSTS = ['api.twilio.com', 'media.twiliocdn.com'];

function isTwilioRecordingUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_RECORDING_HOSTS.includes(u.host);
  } catch (_) {
    return false;
  }
}

function cleanCred(v) {
  return String(v || '').trim().replace(/["']/g, '');
}

// Resolve the company's local id (callers sometimes hold a base44 id) and its
// TwilioSettings row in one pass.
async function getCompanyTwilioSettings(pool, companyId) {
  if (!companyId) return { localId: null, settings: {} };
  let localId = companyId;
  try {
    const { rows } = await pool.query(
      `SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`,
      [companyId]
    );
    if (rows[0]?.id) localId = rows[0].id;
  } catch (_) { /* fall back to the raw id */ }
  try {
    const { rows } = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
      [localId]
    );
    const data = rows[0]?.data;
    const settings = typeof data === 'string' ? JSON.parse(data) : (data || {});
    return { localId, settings };
  } catch (e) {
    console.warn('[CallRecording] TwilioSettings lookup failed:', e.message);
    return { localId, settings: {} };
  }
}

async function twilioStartRecordingRequest(accountSid, authToken, callSid, callbackUrl) {
  const url = twilioApiUrl(`/2010-04-01/Accounts/${accountSid}/Calls/${callSid}/Recordings.json`);
  const body = new URLSearchParams({
    RecordingChannels: 'dual',
    RecordingStatusCallback: callbackUrl,
    RecordingStatusCallbackEvent: 'completed',
    RecordingStatusCallbackMethod: 'POST',
  });
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const json = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, json };
}

/**
 * Start a dual-channel recording on a live call. Fire-and-forget safe: never throws.
 * Gated on TwilioSettings.enable_recording !== false (default ON — same gate the
 * forwarded-call <Dial record> path already uses).
 *
 * @param {object} opts
 * @param {import('pg').Pool} opts.pool
 * @param {string} opts.companyId
 * @param {string} opts.callSid
 * @param {string} opts.publicHost - host (no scheme) Twilio can reach for the status callback
 * @param {string} [opts.callerPhone]
 */
async function startCallRecording({ pool, companyId, callSid, publicHost, callerPhone }) {
  try {
    if (!pool || !companyId || !callSid || !String(callSid).startsWith('CA')) return { started: false, reason: 'no_call' };
    const { localId, settings } = await getCompanyTwilioSettings(pool, companyId);
    if (settings.enable_recording === false) {
      console.log(`[CallRecording] Recording disabled for company ${localId} — skipping`);
      return { started: false, reason: 'disabled' };
    }

    const callbackUrl = `https://${publicHost}/api/functions/recordingWebhook?companyId=${encodeURIComponent(localId || companyId)}${callerPhone ? `&callerPhone=${encodeURIComponent(callerPhone)}` : ''}`;

    // Try the company's own creds first, then platform creds — the call may live
    // on either account (BYO-Twilio vs platform-provisioned numbers).
    const credsToTry = [];
    const coSid = cleanCred(settings.account_sid);
    const coTok = cleanCred(settings.auth_token);
    if (coSid.startsWith('AC') && coTok) credsToTry.push([coSid, coTok, 'company']);
    const envSid = cleanCred(process.env.TWILIO_ACCOUNT_SID);
    const envTok = cleanCred(process.env.TWILIO_AUTH_TOKEN);
    // Skip platform creds only when they are the IDENTICAL sid+token pair.
    // A company row can carry the platform SID with a stale/wrong token —
    // keying the dedupe on SID alone made a 401 unrecoverable (no recording).
    if (envSid.startsWith('AC') && envTok && !(envSid === coSid && envTok === coTok)) credsToTry.push([envSid, envTok, 'platform']);

    if (credsToTry.length === 0) {
      console.warn(`[CallRecording] No Twilio credentials available for company ${localId} — cannot record`);
      return { started: false, reason: 'no_creds' };
    }

    for (const [sid, tok, label] of credsToTry) {
      try {
        const r = await twilioStartRecordingRequest(sid, tok, callSid, callbackUrl);
        if (r.ok) {
          console.log(`[CallRecording] Started dual-channel recording ${r.json?.sid || ''} for ${callSid} (${label} creds) → callback ${callbackUrl}`);
          return { started: true, recordingSid: r.json?.sid || null };
        }
        // 404 = call not found on this account → try the next credential set
        console.warn(`[CallRecording] Recording start failed with ${label} creds (HTTP ${r.status}): ${r.json?.message || ''}`);
      } catch (e) {
        console.warn(`[CallRecording] Recording start error with ${label} creds:`, e.message);
      }
    }
    return { started: false, reason: 'api_error' };
  } catch (e) {
    console.error('[CallRecording] startCallRecording error:', e.message);
    return { started: false, reason: e.message };
  }
}

// Find the Communication row for a call, in either storage location.
// AI-call rows carry call_sid (and now twilio_sid) in the data JSONB; the row
// may live in the dedicated communications table (prod + new dev writes) or in
// generic_entities (legacy dev rows). Excludes the per-utterance live_* rows.
// When companyId is provided the match is scoped to that tenant — the
// recording webhook MUST pass its trusted company so a self-signed callback
// from one tenant can never patch another tenant's call rows.
async function findCommRowByCallSid(pool, callSid, companyId = null) {
  try {
    const r = await pool.query(
      `SELECT id, company_id, data FROM communications
       WHERE (data->>'call_sid' = $1 OR data->>'twilio_sid' = $1)
         AND ($2::text IS NULL OR company_id = $2)
       ORDER BY created_at DESC LIMIT 1`,
      [callSid, companyId]
    );
    if (r.rows.length > 0) return { table: 'communications', ...r.rows[0] };
  } catch (e) {
    console.warn('[CallRecording] communications lookup failed:', e.message);
  }
  try {
    const r = await pool.query(
      `SELECT id, company_id, data FROM generic_entities
       WHERE entity_type = 'Communication'
         AND (data->>'call_sid' = $1 OR data->>'twilio_sid' = $1)
         AND ($2::text IS NULL OR company_id = $2)
         AND id NOT LIKE 'live\\_%'
       ORDER BY created_date DESC LIMIT 1`,
      [callSid, companyId]
    );
    if (r.rows.length > 0) return { table: 'generic_entities', ...r.rows[0] };
  } catch (e) {
    console.warn('[CallRecording] generic_entities lookup failed:', e.message);
  }
  return null;
}

async function patchCommRow(pool, row, patch, { status, durationMinutes } = {}) {
  if (row.table === 'communications') {
    await pool.query(
      `UPDATE communications SET
         data = data || $2::jsonb,
         status = COALESCE($3, status),
         duration_minutes = COALESCE($4, duration_minutes),
         updated_at = NOW()
       WHERE id = $1`,
      [row.id, JSON.stringify(patch), status || null, durationMinutes ?? null]
    );
  } else {
    const merged = { ...patch };
    if (status) merged.status = status;
    if (durationMinutes != null) merged.duration_minutes = durationMinutes;
    await pool.query(
      `UPDATE generic_entities SET data = data || $2::jsonb, updated_date = NOW()
       WHERE id = $1 AND entity_type = 'Communication'`,
      [row.id, JSON.stringify(merged)]
    );
  }
}

/**
 * Download a Twilio recording and transcribe it with Gemini, saving the result
 * onto the Communication row. Never throws; returns { success, length? , error? }.
 * Writes both `transcription` (Communication page) and `transcript`
 * (SarahWorkspace) so every UI reads the same text.
 */
async function transcribeRecording({ pool, row, companyId, recordingUrl, settings, geminiApiKey }) {
  const fail = async (msg, { overwrite = false } = {}) => {
    console.error('[CallRecording] Transcription failed:', msg);
    try {
      const existing = (row.data && (row.data.transcription || row.data.transcript)) || '';
      if (overwrite || !existing || existing.length < 20) {
        await patchCommRow(pool, row, { transcription: `[Transcription failed: ${msg}]` });
      }
    } catch (_) { /* best-effort */ }
    return { success: false, error: msg };
  };

  try {
    if (!isTwilioRecordingUrl(recordingUrl)) return { success: false, error: 'Invalid recording URL' };

    let s = settings;
    if (!s) {
      const looked = await getCompanyTwilioSettings(pool, companyId || row.company_id);
      s = looked.settings;
    }

    const apiKey = geminiApiKey || process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) return fail('GOOGLE_GEMINI_API_KEY is not configured');

    // Auth candidates for the media download (company creds, then platform creds)
    const authCandidates = [];
    const coSid = cleanCred(s?.account_sid);
    const coTok = cleanCred(s?.auth_token);
    if (coSid && coTok) authCandidates.push('Basic ' + Buffer.from(`${coSid}:${coTok}`).toString('base64'));
    const envSid = cleanCred(process.env.TWILIO_ACCOUNT_SID);
    const envTok = cleanCred(process.env.TWILIO_AUTH_TOKEN);
    // Skip platform creds only when they are the IDENTICAL sid+token pair — a
    // company row can carry the platform SID with a stale token (see startCallRecording).
    if (envSid && envTok && !(envSid === coSid && envTok === coTok)) authCandidates.push('Basic ' + Buffer.from(`${envSid}:${envTok}`).toString('base64'));
    if (authCandidates.length === 0) return fail('No Twilio credentials to download the recording');

    // Download with retries — Twilio media sometimes needs a moment to be ready.
    let audioBuffer = null;
    outer: for (let attempt = 1; attempt <= 3; attempt++) {
      for (const auth of authCandidates) {
        try {
          const r = await fetch(recordingUrl, { headers: { Authorization: auth } });
          if (r.ok) {
            audioBuffer = Buffer.from(await r.arrayBuffer());
            break outer;
          }
        } catch (_) { /* retry */ }
      }
      await new Promise(res => setTimeout(res, 2000 * attempt));
    }
    if (!audioBuffer || audioBuffer.length === 0) return fail('Could not download the recording from Twilio');

    // Gemini inline audio limit is ~20 MB — skip absurdly long recordings.
    if (audioBuffer.length > 18 * 1024 * 1024) return fail('Recording too large to transcribe automatically');

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: 'Transcribe this phone call recording verbatim. Label each speaker as "Caller:" or "Agent:" where distinguishable. If only one voice is audible, omit the label. Return only the spoken words — no commentary, timestamps, or summaries.' },
              { inline_data: { mime_type: 'audio/mpeg', data: audioBuffer.toString('base64') } }
            ]
          }],
          generationConfig: { temperature: 0 }
        })
      }
    );
    if (!geminiResp.ok) {
      const errText = await geminiResp.text().catch(() => '');
      return fail(`Gemini API error ${geminiResp.status}${errText ? ` — ${errText.slice(0, 200)}` : ''}`);
    }
    const geminiData = await geminiResp.json();
    const transcription = (geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

    // The recording transcript covers the FULL conversation (dual-channel
    // audio), so it is promoted to the primary transcript. The live Gemini
    // transcript (if any) is an immediate but partial capture — keep it as
    // live_transcription so nothing is lost. An empty recording result never
    // clobbers existing live text.
    const liveText = ((row.data && (row.data.transcription || row.data.transcript)) || '').trim();
    if (!transcription && liveText) {
      console.log(`[CallRecording] Recording transcription came back empty for ${row.id} — keeping live transcript (${liveText.length} chars)`);
      return { success: true, length: liveText.length, kept: 'live' };
    }
    const patch = {
      transcription: transcription || '[No speech detected]',
      transcript: transcription || '[No speech detected]',
      transcription_source: 'recording',
    };
    if (liveText && liveText !== transcription && !(row.data && row.data.live_transcription)) {
      patch.live_transcription = liveText;
    }
    await patchCommRow(pool, row, patch);
    console.log(`[CallRecording] Transcription saved for ${row.id} (${transcription.length} chars)`);
    return { success: true, length: transcription.length };
  } catch (e) {
    return fail(e.message);
  }
}

/**
 * Handle Twilio's recording-status callback (POST /api/functions/recordingWebhook).
 * Responds quickly, then finishes matching/saving/transcription in the background.
 *
 * @param {import('http').IncomingMessage} req - original request (headers used for signature check)
 * @param {import('http').ServerResponse} res
 * @param {string} rawBody - raw x-www-form-urlencoded body
 * @param {import('pg').Pool} pool
 * @param {{ fullUrl?: string }} [opts] - full path+query when req.url was rewritten by middleware mounting
 */
async function handleRecordingWebhook(req, res, rawBody, pool, opts = {}) {
  const respond = (code, text) => {
    if (!res.headersSent) {
      res.writeHead(code, { 'Content-Type': 'text/plain' });
      res.end(text);
    }
  };

  try {
    const fullUrl = opts.fullUrl || req.originalUrl || req.url || '/api/functions/recordingWebhook';
    const parsedUrl = new URL(fullUrl, 'https://placeholder.local');
    const urlCompanyId = parsedUrl.searchParams.get('companyId') || '';
    const urlCallerPhone = parsedUrl.searchParams.get('callerPhone') || '';
    const urlRepName = parsedUrl.searchParams.get('repName') || '';

    const form = new URLSearchParams(rawBody || '');
    const callSid = form.get('CallSid') || '';
    const recordingUrl = form.get('RecordingUrl') || '';
    const recordingSid = form.get('RecordingSid') || '';
    const recordingDuration = parseInt(form.get('RecordingDuration') || '0', 10) || 0;
    const accountSid = form.get('AccountSid') || '';

    console.log(`[CallRecording] Webhook fired. CallSid=${callSid} RecSid=${recordingSid} Dur=${recordingDuration}s`);

    if (!recordingUrl || !accountSid || !callSid) { respond(200, 'OK'); return; }

    // SSRF guard: only ever touch genuine Twilio recording URLs.
    if (!isTwilioRecordingUrl(recordingUrl)) {
      console.error('[CallRecording] Rejected non-Twilio recording URL:', recordingUrl);
      respond(403, 'Forbidden');
      return;
    }

    // Twilio signature verification (MONITOR mode by default; enforce via
    // TWILIO_REQUIRE_SIGNATURE=1 — same convention as the other webhooks).
    const verifyReq = { headers: req.headers, url: fullUrl };
    const verification = await verifyTwilioWebhook(verifyReq, rawBody, pool, { companyId: urlCompanyId });
    if (shouldRejectTwilio(verification, 'recordingWebhook')) {
      respond(403, 'Forbidden');
      return;
    }
    const settings = verification.settings || {};

    // Decide which tenant this callback is trusted for. A 'company' token
    // match only proves the sender knows that company's own auth token — a
    // hostile BYO tenant can self-sign an arbitrary payload — so in that case
    // ONLY that company's rows may be touched and the URL's companyId is NOT
    // trusted. A 'platform' token match proves Twilio itself signed the
    // callback URL we generated, so its companyId param is trustworthy.
    const trustedCompanyId = (verification.valid && verification.matchedToken === 'company')
      ? (settings.company_id || null)
      : (urlCompanyId || settings.company_id || null);

    // Answer Twilio right away — matching may need to wait for the hang-up
    // save to land, and transcription can take a while.
    respond(200, 'OK');

    (async () => {
      try {
        // The Communication row is written at hang-up (or mid-call in prod);
        // the recording callback can beat it, so retry the match a few times.
        // The lookup is scoped to the trusted tenant (see above).
        let row = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          row = await findCommRowByCallSid(pool, callSid, trustedCompanyId);
          if (row) break;
          await new Promise(r => setTimeout(r, 4000));
        }

        // Defense-in-depth: never patch a row outside the trusted tenant.
        if (row && trustedCompanyId && row.company_id && row.company_id !== trustedCompanyId) {
          console.error(`[CallRecording] Cross-tenant row match blocked: row ${row.id} (company ${row.company_id}) vs trusted ${trustedCompanyId}`);
          return;
        }

        if (!row) {
          const fallbackCompanyId = trustedCompanyId;
          if (!fallbackCompanyId) {
            console.error('[CallRecording] No Communication match and no companyId — dropping recording for', callSid);
            return;
          }
          const commId = `comm_rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const fallbackData = {
            call_sid: callSid,
            twilio_sid: callSid,
            source: 'recording_webhook',
            message: urlRepName
              ? `Forwarded call handled by ${urlRepName}. Recording arrived before the call record was created.`
              : 'Call record was missing when the recording arrived; created automatically.',
          };
          await pool.query(
            `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_phone, contact_name, status, duration_minutes, data, created_at, updated_at)
             VALUES ($1,$2,'call','call','inbound',$3,$4,'completed',$5,$6::jsonb,NOW(),NOW())
             ON CONFLICT (id) DO NOTHING`,
            [
              commId, fallbackCompanyId,
              urlCallerPhone || 'Unknown',
              urlCallerPhone ? `Caller ${urlCallerPhone}` : 'Unknown Caller',
              recordingDuration ? Math.max(1, Math.ceil(recordingDuration / 60)) : null,
              JSON.stringify(fallbackData),
            ]
          );
          row = { table: 'communications', id: commId, company_id: fallbackCompanyId, data: fallbackData };
          console.log('[CallRecording] Created fallback Communication:', commId);
        }

        const mp3Url = recordingUrl + '.mp3';
        const patch = { recording_url: mp3Url };
        if (recordingSid) patch.recording_sid = recordingSid;
        await patchCommRow(pool, row, patch, {
          status: 'completed',
          durationMinutes: recordingDuration ? Math.max(1, Math.ceil(recordingDuration / 60)) : null,
        });
        console.log(`[CallRecording] Recording URL saved to ${row.table} row ${row.id}`);

        // Always transcribe the recording when transcription is enabled — the
        // live Gemini transcript is an immediate but PARTIAL capture (utterance
        // events can be missed), so the recording is the source of truth for
        // the full conversation. transcribeRecording promotes it to the primary
        // transcript and preserves the live text as live_transcription; skip
        // only if a recording transcript already exists (Twilio retries the
        // callback, and a second Gemini pass would just burn quota).
        const autoTranscribe = settings.enable_transcription !== false;
        const alreadyFromRecording = row.data && row.data.transcription_source === 'recording';
        if (autoTranscribe && !alreadyFromRecording) {
          await transcribeRecording({
            pool, row,
            companyId: row.company_id,
            recordingUrl: mp3Url,
            settings: settings.auth_token ? settings : null,
          });
        }
      } catch (bgErr) {
        console.error('[CallRecording] Webhook background processing error:', bgErr.message);
      }
    })();
  } catch (e) {
    console.error('[CallRecording] Webhook error:', e.message);
    respond(200, 'ERROR');
  }
}

module.exports = {
  startCallRecording,
  handleRecordingWebhook,
  transcribeRecording,
  findCommRowByCallSid,
  isTwilioRecordingUrl,
};
