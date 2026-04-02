import twilio from 'npm:twilio@5.0.0';

export async function sendSMSInternal(base44, { to, body, companyId, contactName, userEmail }) {
    if (!to || !body) throw new Error('Missing to/body');

    console.log(`[SMS] Starting send to ${to} for company ${companyId || 'unknown'}`);

    // --- CREDENTIAL RESOLUTION LOGIC ---
    const envSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const envToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const envPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

    let dbSettings = null;
    let targetCompanyId = companyId;
    
    // If no companyId, try to find one from userEmail (if provided)
    if (!targetCompanyId && userEmail) {
        // Check StaffProfile first
        const staff = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: userEmail });
        if (staff?.length > 0 && staff[0].company_id) {
            targetCompanyId = staff[0].company_id;
        } else {
            const companies = await base44.asServiceRole.entities.Company.filter({ created_by: userEmail });
            if (companies?.length > 0) targetCompanyId = companies[0].id;
        }
    }

    if (targetCompanyId) {
        const settings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: targetCompanyId });
        if (settings?.length > 0) dbSettings = settings[0];
    }

    // Improved cleaner matching testTwilioCredentials
    const clean = (val) => val ? String(val).trim().replace(/[\s\u200B-\u200D\uFEFF"']/g, '') : '';
    const isValidSid = (sid) => clean(sid).startsWith('AC');

    let finalSid = '';
    let finalToken = '';
    let finalPhone = '';
    let source = '';

    // 1. Try DB first - MUST have ALL valid credentials including phone
    if (dbSettings && isValidSid(dbSettings.account_sid) && dbSettings.auth_token && dbSettings.main_phone_number) {
        finalSid = clean(dbSettings.account_sid);
        finalToken = clean(dbSettings.auth_token);
        finalPhone = clean(dbSettings.main_phone_number);
        source = 'DB';
    }

    // 2. Fallback to Env Vars if DB failed
    if (!finalSid && isValidSid(envSid) && envToken && envPhone) {
        finalSid = clean(envSid);
        finalToken = clean(envToken);
        finalPhone = clean(envPhone);
        source = 'ENV';
    }

    console.log(`[SMS] Credential Source: ${source || 'NONE'}`);

    if (!finalSid.startsWith('AC')) {
        throw new Error('Twilio is not configured for this company. Please configure it in Company Settings.');
    }
    if (!finalToken) {
        throw new Error('Missing Twilio Auth Token.');
    }
    if (!finalPhone) {
        throw new Error('Missing Twilio Phone Number.');
    }

    // --- SEND SMS ---
    try {
        const client = twilio(finalSid, finalToken);
        const message = await client.messages.create({
            body: body,
            from: finalPhone,
            to: to
        });

        console.log('[SMS] Sent successfully, SID:', message.sid);

        // Log to Communication entity
        if (targetCompanyId) {
            try {
                await base44.asServiceRole.entities.Communication.create({
                    company_id: targetCompanyId,
                    contact_phone: to,
                    contact_name: contactName || 'Unknown',
                    communication_type: 'sms',
                    direction: 'outbound',
                    message: body,
                    twilio_sid: message.sid,
                    status: 'sent',
                    created_by: userEmail || 'system'
                });
            } catch (logError) {
                console.error('[SMS] Failed to log to DB:', logError);
                // Don't fail the request if logging fails
            }
        }

        return { success: true, sid: message.sid };
    } catch (error) {
        console.error('[SMS] Twilio API Error:', error);
        
        let errorMsg = error.message;
        if (error.code === 21211) errorMsg = "Invalid 'To' Phone Number.";
        if (error.code === 21606) errorMsg = "The 'From' phone number is not valid for this account.";
        if (error.code === 20003) errorMsg = "Authentication Error - Check Account SID and Auth Token.";
        if (error.code === 21608) errorMsg = "This number is unverified (Trial Account).";

        throw new Error(`Twilio Error (${source}): ${errorMsg} (Code: ${error.code})`);
    }
}