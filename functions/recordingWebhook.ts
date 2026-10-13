import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import twilio from 'npm:twilio';

// Only fetch recordings from these Twilio hosts. We forward the URL to
// transcribeRecording, so we MUST validate it here to prevent SSRF.
const ALLOWED_RECORDING_HOSTS = ['api.twilio.com', 'media.twiliocdn.com'];

function isTwilioRecordingUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && ALLOWED_RECORDING_HOSTS.includes(u.host);
    } catch {
        return false;
    }
}

Deno.serve(async (req) => {
    try {
        // Read body once; needed for both signature validation and parsing
        const rawText = await req.text();
        const formData = new URLSearchParams(rawText);
        const callSid = formData.get('CallSid');
        const recordingUrl = formData.get('RecordingUrl');
        const recordingSid = formData.get('RecordingSid');
        const recordingDuration = formData.get('RecordingDuration');
        const accountSid = formData.get('AccountSid');

        // Extra context passed in the callback URL for forwarded-call recordings
        const reqUrl = new URL(req.url);
        const urlCallerPhone = reqUrl.searchParams.get('callerPhone') || '';
        const urlRepName = reqUrl.searchParams.get('repName') || '';
        const urlCompanyId = reqUrl.searchParams.get('companyId') || '';

        console.log('🎙️ Recording webhook fired. CallSid:', callSid, 'RecSid:', recordingSid, 'Dur:', recordingDuration);

        if (!recordingUrl || !accountSid) {
            console.error('❌ Missing RecordingUrl or AccountSid');
            return new Response('OK');
        }

        // 🔒 SSRF GUARD: Twilio recordings only
        if (!isTwilioRecordingUrl(recordingUrl)) {
            console.error('🛑 Rejected non-Twilio recording URL:', recordingUrl);
            return new Response('Forbidden', { status: 403 });
        }

        const base44 = createClientFromRequest(req);

        // Look up settings by AccountSid, falling back to URL-provided companyId
        const tsList = await base44.asServiceRole.entities.TwilioSettings.filter({ account_sid: accountSid });
        const settings = tsList?.[0];
        if (!settings?.auth_token) {
            console.error('🛑 No auth_token found for account:', accountSid);
            return new Response('Forbidden', { status: 403 });
        }
        const cleanToken = String(settings.auth_token).trim().replace(/["']/g, '');

        // 🔒 Twilio webhook signature validation
        // We try two URL variants because reverse-proxies (Cloudflare, ngrok, etc.) sometimes
        // rewrite the scheme or strip ports — causing validateRequest to fail even for legitimate
        // Twilio callbacks. If the first attempt fails, we try the canonical public URL.
        const sig = req.headers.get('x-twilio-signature') || '';
        const params: Record<string, string> = {};
        for (const [k, v] of formData.entries()) params[k] = v;

        let signatureValid = false;

        // Attempt 1: exact req.url (works when Twilio can reach the server directly)
        if (sig) {
            try {
                signatureValid = twilio.validateRequest(cleanToken, sig, req.url, params);
                if (signatureValid) console.log('✅ Twilio signature valid (attempt 1)');
            } catch (e) {
                console.warn('⚠️ Signature validation attempt 1 threw:', e.message);
            }
        }

        // Attempt 2: canonical public URL from env var (handles reverse-proxy URL rewrites)
        if (!signatureValid && sig) {
            try {
                const publicHost = Deno.env.get('PUBLIC_HOST') ||
                    Deno.env.get('REPLIT_WS_URL')?.replace('wss://', 'https://').replace('ws://', 'http://') ||
                    '';
                if (publicHost) {
                    const reqPath = new URL(req.url).pathname + new URL(req.url).search;
                    const canonicalUrl = `${publicHost}${reqPath}`;
                    signatureValid = twilio.validateRequest(cleanToken, sig, canonicalUrl, params);
                    if (signatureValid) console.log('✅ Twilio signature valid (attempt 2, canonical URL)');
                }
            } catch (e) {
                console.warn('⚠️ Signature validation attempt 2 threw:', e.message);
            }
        }

        if (!signatureValid) {
            // Check if this company has opted into the signature-bypass fallback.
            // This is intended for environments where a reverse-proxy permanently rewrites
            // the URL in a way we cannot predict (e.g. both req.url and PUBLIC_HOST differ
            // from what Twilio signed). The SSRF guard above already ensures the recording URL
            // is a genuine Twilio domain, so the security risk of enabling this is low.
            // TwilioSettings.allow_recording_webhook_without_signature is an optional boolean field.
            // When absent or false (the default), validation failures still reject the webhook (secure).
            // Set to true only when a reverse-proxy permanently mangles URLs that can't be
            // predicted by either req.url or PUBLIC_HOST/REPLIT_WS_URL.
            const bypassEnabled = settings.allow_recording_webhook_without_signature === true;

            if (!sig) {
                console.warn('⚠️ No x-twilio-signature header on recording webhook. req.url=', req.url, '| bypassEnabled=', bypassEnabled);
            } else {
                console.error('🛑 Invalid Twilio signature for recording webhook. req.url=', req.url, '| bypassEnabled=', bypassEnabled);
            }

            if (!bypassEnabled) {
                return new Response('Forbidden', { status: 403 });
            }

            // Bypass path: process the recording but leave a clear audit trail on the record.
            console.warn('⚠️ Signature bypass active — processing recording despite failed validation. CallSid:', callSid);
            // We will annotate the Communication record after finding/creating it (see below).
        }

        // Find the communication record (or create fallback)
        let comm = null;
        const comms = await base44.asServiceRole.entities.Communication.filter({ twilio_sid: callSid });
        if (comms && comms.length > 0) {
            comm = comms[0];
        } else {
            console.log('⚠️ No Communication for CallSid, creating fallback. AccountSid:', accountSid);
            try {
                const fallbackCompanyId = settings.company_id || urlCompanyId || null;
                const fallbackCallerPhone = urlCallerPhone || 'Unknown';
                const fallbackContactName = urlCallerPhone
                    ? `Caller ${urlCallerPhone}`
                    : 'Unknown Caller';
                const fallbackSubject = urlRepName
                    ? `Forwarded call — Rep: ${urlRepName}`
                    : 'Recovered Call Recording';
                comm = await base44.asServiceRole.entities.Communication.create({
                    company_id: fallbackCompanyId,
                    contact_name: fallbackContactName,
                    contact_phone: fallbackCallerPhone,
                    communication_type: 'call',
                    direction: 'inbound',
                    subject: fallbackSubject,
                    message: urlRepName
                        ? `Forwarded call handled by ${urlRepName}. Recording arrived before Communication record was created.`
                        : 'Communication record was missing when recording arrived; created automatically.',
                    twilio_sid: callSid,
                    status: 'completed'
                });
                console.log('✅ Created fallback Communication:', comm.id);
            } catch (createErr) {
                console.error('❌ Failed to create fallback Communication:', createErr.message);
                return new Response('OK');
            }
        }

        const mp3Url = recordingUrl + '.mp3';

        // If we bypassed signature validation, note it on the Communication record for audit.
        if (!signatureValid) {
            try {
                const bypassNote = `[⚠️ Recording webhook signature validation failed. Recording was accepted because allow_recording_webhook_without_signature is enabled. req.url=${req.url}]`;
                await base44.asServiceRole.entities.Communication.update(comm.id, {
                    transcription: bypassNote
                });
            } catch (_) { /* non-critical */ }
        }

        // Save the critical recording_url first; this is the field the UI reads.
        await base44.asServiceRole.entities.Communication.update(comm.id, {
            recording_url: mp3Url,
            status: 'completed',
            duration_minutes: recordingDuration ? Math.ceil(parseInt(recordingDuration) / 60) : (comm.duration_minutes || 0)
        });
        console.log('✅ Saved recording URL to Communication:', comm.id);

        // Try to save recording_sid separately so an unknown-column error can't
        // wipe out the recording_url save above.
        if (recordingSid) {
            try {
                await base44.asServiceRole.entities.Communication.update(comm.id, { recording_sid: recordingSid });
            } catch (sidErr) {
                console.warn('⚠️ Could not persist recording_sid (non-critical):', sidErr.message);
            }
        }

        const autoTranscribe = settings.enable_transcription !== false; // default ON

        if (autoTranscribe) {
            // Internal shared secret so transcribeRecording can verify the caller
            const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET') || cleanToken; // fallback to twilio token
            // Use the same public-host resolution as recording callback so the internal
            // fetch actually reaches the function endpoint.
            const publicHost = Deno.env.get('PUBLIC_HOST') ||
                Deno.env.get('REPLIT_WS_URL')?.replace('wss://', 'https://').replace('ws://', 'http://') ||
                new URL(req.url).origin;
            fetch(`${publicHost}/api/functions/transcribeRecording`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-internal-secret': internalSecret
                },
                body: JSON.stringify({
                    communicationId: comm.id,
                    recordingUrl: mp3Url,
                    recordingSid: recordingSid,
                    callSid: callSid,
                    companyId: comm.company_id,
                    duration: recordingDuration ? parseInt(recordingDuration) : 0
                })
            }).catch(err => console.error('⚠️ Failed to enqueue transcription:', err.message));
            console.log('🚀 Transcription enqueued for:', comm.id);
        }

        return new Response('OK');

    } catch (error) {
        console.error('❌ Recording Webhook Error:', error);
        return new Response('ERROR');
    }
});
