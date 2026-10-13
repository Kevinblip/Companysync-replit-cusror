import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Allow admins to manually retry a failed transcription for a call record.
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        const { communicationId, companyId, force } = body;

        if (!communicationId || !companyId) {
            return Response.json({ error: 'communicationId and companyId are required' }, { status: 400 });
        }

        // Auth: only admins or the company owner may trigger a retry
        let allowed = false;
        try {
            const me = await base44.auth.me();
            if (me) {
                if (me.platform_role === 'super_admin') {
                    allowed = true;
                } else {
                    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
                    const isOwner = companies?.length > 0 && companies[0].created_by === me.email;
                    const staff = await base44.asServiceRole.entities.StaffProfile.filter({
                        user_email: me.email,
                        company_id: companyId
                    });
                    const isAdmin = staff?.some((s) => s.is_administrator === true);
                    allowed = isOwner || isAdmin;
                }
            }
        } catch { /* not signed in */ }

        if (!allowed) {
            return Response.json({ error: 'Unauthorized — admin access required' }, { status: 401 });
        }

        // Look up the communication record to get the recording URL
        const comms = await base44.asServiceRole.entities.Communication.filter({ id: communicationId });
        const comm = comms?.[0];

        if (!comm) {
            return Response.json({ error: 'Communication record not found' }, { status: 404 });
        }

        // Tenant binding: ensure the communication belongs to the requesting company
        if (comm.company_id !== companyId) {
            console.error(`🛑 retryTranscription: comm ${communicationId} belongs to company ${comm.company_id}, not ${companyId}`);
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!comm.recording_url) {
            return Response.json({ error: 'No recording URL on this communication record' }, { status: 422 });
        }

        // Only retry if the transcription is in a failed/missing state,
        // unless the caller explicitly forces an overwrite.
        const transcription = comm.transcription || '';
        const isFailed = !transcription || /^\[Transcription (failed|unavailable)/.test(transcription);
        if (!isFailed && !force) {
            return Response.json({
                error: 'Transcription already exists and has not failed',
                requires_force: true
            }, { status: 422 });
        }
        if (!isFailed && force) {
            console.log(`⚠️ retryTranscription: force-overwriting existing transcription for comm ${communicationId}`);
        }

        // Resolve the internal host used to call other functions
        const publicHost = Deno.env.get('PUBLIC_HOST') ||
            Deno.env.get('REPLIT_WS_URL')?.replace('wss://', 'https://').replace('ws://', 'http://') ||
            new URL(req.url).origin;

        // Obtain the internal secret so transcribeRecording accepts the call
        let internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET') || '';
        if (!internalSecret) {
            try {
                const settings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: companyId });
                const tok = settings?.[0]?.auth_token;
                if (tok) internalSecret = String(tok).trim().replace(/["']/g, '');
            } catch { /* non-critical */ }
        }

        console.log(`🔄 retryTranscription: invoking transcribeRecording for comm ${communicationId}`);

        // Await the transcription so we can report success or failure to the caller
        const transcribeResp = await fetch(`${publicHost}/api/functions/transcribeRecording`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(internalSecret ? { 'x-internal-secret': internalSecret } : {}),
                Cookie: req.headers.get('cookie') || '',
                Authorization: req.headers.get('authorization') || ''
            },
            body: JSON.stringify({
                communicationId,
                companyId,
                recordingUrl: comm.recording_url,
                recordingSid: comm.recording_sid || '',
                callSid: comm.call_sid || '',
                duration: comm.duration || 0
            })
        });

        if (!transcribeResp.ok) {
            let errDetail = '';
            try { errDetail = (await transcribeResp.json()).error || ''; } catch { /* ignore */ }
            console.error(`❌ retryTranscription: transcribeRecording returned ${transcribeResp.status}: ${errDetail}`);
            return Response.json(
                { error: errDetail || `Transcription failed (HTTP ${transcribeResp.status})` },
                { status: 500 }
            );
        }

        const transcribeResult = await transcribeResp.json();
        console.log(`✅ retryTranscription: transcription complete for comm ${communicationId}, length=${transcribeResult.length ?? '?'}`);
        return Response.json({ success: true });

    } catch (error) {
        console.error('❌ retryTranscription error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});
