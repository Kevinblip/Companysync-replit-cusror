import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { sendEmail } from './_sendEmail.ts';

// Recording host allowlist — never apply Twilio basic auth to a non-Twilio domain.
const ALLOWED_RECORDING_HOSTS = ['api.twilio.com', 'media.twiliocdn.com'];
function isTwilioRecordingUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && ALLOWED_RECORDING_HOSTS.includes(u.host);
    } catch {
        return false;
    }
}

/**
 * Notify all company admins (and the company owner) that a transcription
 * (or recording download) failed.
 * Best-effort — any error is swallowed so it never blocks the webhook response.
 */
async function alertAdminsOfFailure(base44, { communicationId, companyId, errorReason }) {
    try {
        // Fetch the Communication record to get caller details
        let comm = null;
        try {
            const comms = await base44.asServiceRole.entities.Communication.filter({ id: communicationId });
            comm = comms?.[0] || null;
        } catch (_) { /* non-critical */ }

        const callerName = comm?.contact_name || 'Unknown Caller';
        const callerPhone = comm?.contact_phone || 'Unknown';
        const callDate = comm?.created_date
            ? new Date(comm.created_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'Unknown date';

        const title = 'Call transcription failed';
        const message = `A transcription failed and requires attention.\n\nCaller: ${callerName} (${callerPhone})\nDate: ${callDate}\nReason: ${errorReason}`;

        // Build the recipient list: all admin staff + the company owner (created_by).
        // De-duplicate so the owner who is also an admin only gets one notification.
        const recipientEmails = new Set<string>();

        // 1. Company owner (may or may not have a StaffProfile entry)
        try {
            const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
            const ownerEmail = companies?.[0]?.created_by;
            if (ownerEmail) recipientEmails.add(ownerEmail);
        } catch (_) { /* non-critical */ }

        // 2. Staff marked as administrators
        try {
            const allStaff = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId });
            for (const s of allStaff) {
                if (s.is_administrator === true && s.user_email) {
                    recipientEmails.add(s.user_email);
                }
            }
        } catch (_) { /* non-critical */ }

        if (recipientEmails.size === 0) {
            console.warn('⚠️ transcribeRecording: no admins/owner to notify for company:', companyId);
            return;
        }

        let notifiedCount = 0;
        for (const email of recipientEmails) {
            try {
                await base44.asServiceRole.entities.Notification.create({
                    company_id: companyId,
                    user_email: email,
                    title,
                    message,
                    type: 'general',
                    related_entity_type: 'Communication',
                    related_entity_id: communicationId,
                    is_read: false
                });
                notifiedCount++;
            } catch (e) {
                console.error(`⚠️ Failed to notify recipient ${email}:`, e.message);
            }
        }

        // Also send email via Resend so admins get an out-of-app alert even when not logged in.
        // Respect each recipient's NotificationPreference (skip emailing anyone who muted all
        // notifications). In-app bell notifications above remain unconditional since they're
        // critical alerts.
        if (recipientEmails.size > 0) {
            // Build a map of email -> preferences for the company
            const mutedEmails = new Set<string>();
            try {
                const allPreferences = await base44.asServiceRole.entities.NotificationPreference.filter({ company_id: companyId });
                for (const p of allPreferences) {
                    if (!p?.user_email) continue;
                    const muteAll = p?.mute_all_notifications === true;
                    // notify_on_transcription_failure defaults to true when the field is absent
                    const optedOut = p?.notify_on_transcription_failure === false;
                    if (muteAll) {
                        mutedEmails.add(p.user_email);
                        console.log(`🔕 Skipping transcription failure email for ${p.user_email} (Mute All)`);
                    } else if (optedOut) {
                        mutedEmails.add(p.user_email);
                        console.log(`🔕 Skipping transcription failure email for ${p.user_email} (Transcription Failure opt-out)`);
                    }
                }
            } catch (prefErr) {
                console.error('⚠️ Failed to load NotificationPreference (will email all admins):', prefErr.message);
            }

            try {

                const fromAddr = Deno.env.get('EMAIL_FROM') || 'CompanySync <noreply@companysync.io>';

                // Build a deep link to the specific failed call record. The base URL
                // is configurable via APP_BASE_URL so non-prod environments can point
                // somewhere other than app.mycrewcam.com.
                const rawBaseUrl = (Deno.env.get('APP_BASE_URL') || 'https://app.mycrewcam.com').trim();
                const baseUrl = rawBaseUrl.replace(/\/+$/, '');
                const callRecordUrl = `${baseUrl}/communication?id=${encodeURIComponent(communicationId)}`;

                // Escape user-derived values before embedding in HTML
                const escHtml = (s: string) =>
                    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                const safeCallerName  = escHtml(callerName);
                const safeCallerPhone = escHtml(callerPhone);
                const safeCallDate    = escHtml(callDate);
                const safeReason      = escHtml(errorReason);
                const safeCallRecordUrl = escHtml(callRecordUrl);

                const subject = `⚠️ Call Transcription Failed — ${safeCallerName}`;
                const emailBody = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#222;">
  <h2 style="margin-top:0;color:#d9534f;">Call Transcription Failed</h2>
  <p>A call transcription failed and requires your attention.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0;">
    <tr>
      <td style="padding:8px 12px;font-weight:bold;background:#f5f5f5;border:1px solid #ddd;width:120px;">Caller</td>
      <td style="padding:8px 12px;border:1px solid #ddd;">${safeCallerName} (${safeCallerPhone})</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;font-weight:bold;background:#f5f5f5;border:1px solid #ddd;">Call Date</td>
      <td style="padding:8px 12px;border:1px solid #ddd;">${safeCallDate}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;font-weight:bold;background:#f5f5f5;border:1px solid #ddd;">Reason</td>
      <td style="padding:8px 12px;border:1px solid #ddd;">${safeReason}</td>
    </tr>
  </table>
  <p>
    <a href="${safeCallRecordUrl}" style="display:inline-block;padding:10px 20px;background:#1a73e8;color:#fff;text-decoration:none;border-radius:4px;">
      View Call Record
    </a>
  </p>
  <p style="font-size:12px;color:#888;margin-top:24px;border-top:1px solid #eee;padding-top:16px;">
    You are receiving this alert because you are an administrator on your PhotoSync account.
    <a href="${baseUrl}/GeneralSettings" style="color:#1a73e8;text-decoration:none;">Manage your notification preferences.</a>
  </p>
</div>`;

                let emailsSent = 0;
                let emailsSkipped = 0;
                for (const email of recipientEmails) {
                    if (mutedEmails.has(email)) {
                        emailsSkipped++;
                        continue;
                    }
                    try {
                        await sendEmail({ from: fromAddr, to: [email], subject, html: emailBody });
                        emailsSent++;
                    } catch (perEmailErr) {
                        console.error(`⚠️ Failed to email ${email}:`, perEmailErr.message);
                    }
                }
                console.log(`📧 Transcription failure email sent to ${emailsSent}/${recipientEmails.size} admin(s)${emailsSkipped ? ` (${emailsSkipped} muted)` : ''}`);
            } catch (emailErr) {
                console.error('⚠️ Transcription failure email send failed (non-critical):', emailErr.message);
            }
        }

        console.log(`📣 Transcription failure alert sent to ${notifiedCount}/${recipientEmails.size} recipient(s) for comm ${communicationId}`);
    } catch (e) {
        console.error('⚠️ alertAdminsOfFailure threw (non-critical):', e.message);
    }
}

// Downloads the Twilio recording, transcribes via OpenAI Whisper, saves
// transcription, then chains to processCallRecording for the Sarah summary.
//
// Authentication: requires header x-internal-secret matching either the
// INTERNAL_FUNCTION_SECRET env var OR the company's Twilio auth_token (so the
// recordingWebhook can call us right after validating Twilio's signature).
Deno.serve(async (req) => {
    let communicationId: string | undefined;
    let companyId: string | undefined;
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        communicationId = body.communicationId;
        companyId = body.companyId;
        const { recordingUrl, recordingSid, callSid, duration } = body;

        console.log('🎤 transcribeRecording start:', { communicationId, duration });

        if (!communicationId || !recordingUrl) {
            return Response.json({ error: 'communicationId and recordingUrl required' }, { status: 400 });
        }

        // 🔒 SSRF GUARD
        if (!isTwilioRecordingUrl(recordingUrl)) {
            console.error('🛑 Rejected non-Twilio recording URL:', recordingUrl);
            return Response.json({ error: 'Invalid recording URL' }, { status: 403 });
        }

        // 1. Get Twilio creds (also used to verify the internal caller secret)
        const settings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: companyId });
        const twilio = settings?.[0];
        if (!twilio?.account_sid || !twilio?.auth_token) {
            console.error('❌ Twilio creds missing for company:', companyId);
            return Response.json({ error: 'Twilio creds missing' }, { status: 500 });
        }
        const sid = String(twilio.account_sid).trim().replace(/["']/g, '');
        const tok = String(twilio.auth_token).trim().replace(/["']/g, '');

        // 🔒 Internal auth: must come from recordingWebhook OR an authenticated user
        // who has access to THIS company (super_admin, owner, or staff).
        const incomingSecret = req.headers.get('x-internal-secret') || '';
        const expectedSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET') || tok;
        let allowed = incomingSecret && incomingSecret === expectedSecret;
        if (!allowed) {
            try {
                const me = await base44.auth.me();
                if (me) {
                    if (me.platform_role === 'super_admin') {
                        allowed = true;
                    } else {
                        const company = await base44.asServiceRole.entities.Company.filter({ id: companyId });
                        const isOwner = company?.length > 0 && company[0].created_by === me.email;
                        const staff = await base44.asServiceRole.entities.StaffProfile.filter({
                            user_email: me.email, company_id: companyId
                        });
                        allowed = isOwner || (staff && staff.length > 0);
                    }
                }
            } catch { /* not signed in */ }
        }
        if (!allowed) {
            console.error('🛑 transcribeRecording: unauthorized caller for company', companyId);
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const geminiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY');
        if (!geminiKey) {
            console.error('❌ GOOGLE_GEMINI_API_KEY not set, cannot transcribe');
            try {
                await base44.asServiceRole.entities.Communication.update(communicationId, {
                    transcription: '[Transcription unavailable — GOOGLE_GEMINI_API_KEY is not configured. Contact your administrator.]'
                });
            } catch (_) { /* best-effort */ }
            await alertAdminsOfFailure(base44, {
                communicationId,
                companyId,
                errorReason: 'GOOGLE_GEMINI_API_KEY is not configured on the server.'
            });
            return Response.json({ error: 'GOOGLE_GEMINI_API_KEY not configured' }, { status: 500 });
        }

        const basicAuth = 'Basic ' + btoa(`${sid}:${tok}`);

        // 2. Download recording (retry up to 3x — sometimes Twilio needs a moment)
        let audioBuffer: ArrayBuffer | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const r = await fetch(recordingUrl, { headers: { Authorization: basicAuth } });
                if (r.ok) {
                    audioBuffer = await r.arrayBuffer();
                    console.log(`✅ Downloaded recording (attempt ${attempt}, size=${audioBuffer.byteLength})`);
                    break;
                }
                console.warn(`⚠️ Download attempt ${attempt} returned ${r.status}`);
            } catch (e) {
                console.warn(`⚠️ Download attempt ${attempt} failed:`, e.message);
            }
            await new Promise(res => setTimeout(res, 2000 * attempt));
        }

        if (!audioBuffer || audioBuffer.byteLength === 0) {
            console.error('❌ Could not download recording after retries');
            await base44.asServiceRole.entities.Communication.update(communicationId, {
                transcription: '[Transcription failed: could not download recording]'
            });
            await alertAdminsOfFailure(base44, {
                communicationId,
                companyId,
                errorReason: 'Could not download the recording file from Twilio after 3 attempts.'
            });
            return Response.json({ error: 'Recording download failed' }, { status: 500 });
        }

        // 3. Transcribe with Gemini 2.5 Flash (inline audio base64)
        // Gemini supports audio/mpeg inline up to ~20 MB — well within typical call recording sizes.
        const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));

        const geminiResp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: 'Transcribe this phone call recording verbatim. Label each speaker as "Caller:" or "Agent:" where distinguishable. If only one voice is audible, omit the label. Return only the spoken words — no commentary, timestamps, or summaries.' },
                            { inline_data: { mime_type: 'audio/mpeg', data: audioBase64 } }
                        ]
                    }],
                    generationConfig: { temperature: 0 }
                })
            }
        );

        if (!geminiResp.ok) {
            const err = await geminiResp.text();
            console.error('❌ Gemini transcription error:', geminiResp.status, err);
            await base44.asServiceRole.entities.Communication.update(communicationId, {
                transcription: `[Transcription failed: Gemini API error ${geminiResp.status}]`
            });
            await alertAdminsOfFailure(base44, {
                communicationId,
                companyId,
                errorReason: `Gemini API returned HTTP ${geminiResp.status} during transcription.`
            });
            return Response.json({ error: 'Gemini transcription failed', details: err }, { status: 500 });
        }

        const geminiData = await geminiResp.json();
        const transcription = (geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        console.log('✅ Gemini transcription length:', transcription.length);

        // 4. Save transcription
        await base44.asServiceRole.entities.Communication.update(communicationId, {
            transcription: transcription || '[No speech detected]'
        });

        // 5. Trigger Sarah's summary (only if we got real text AND auto-summary is enabled)
        const autoSummary = !twilio || twilio.enable_ai_summary !== false; // default ON
        if (autoSummary && transcription && transcription.length > 20) {
            const baseUrl = new URL(req.url).origin;
            fetch(`${baseUrl}/api/functions/processCallRecording`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Pass through auth so processCallRecording can use service role
                    Cookie: req.headers.get('cookie') || '',
                    Authorization: req.headers.get('authorization') || ''
                },
                body: JSON.stringify({
                    callSid, companyId, recordingUrl, duration: duration || 0
                })
            }).catch(err => console.error('⚠️ Failed to enqueue summary:', err.message));
            console.log('🚀 Sarah summary enqueued for:', communicationId);
        }

        return Response.json({ success: true, length: transcription.length });

    } catch (error) {
        console.error('❌ transcribeRecording error:', error);
        // Best-effort alert for unexpected runtime errors (communicationId/companyId may be undefined)
        if (communicationId && companyId) {
            const base44Fallback = createClientFromRequest(req);
            await alertAdminsOfFailure(base44Fallback, {
                communicationId,
                companyId,
                errorReason: `Unexpected error: ${error?.message || 'unknown'}`
            });
        }
        return Response.json({ error: error.message }, { status: 500 });
    }
});
