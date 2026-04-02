import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import twilio from 'npm:twilio';

Deno.serve(async (req) => {
    try {
        console.log('📞 makeCall function started');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { to, contactName, companyId } = body;

        if (!to) {
            return Response.json({ error: 'Phone number (to) is required' }, { status: 400 });
        }

        // 🔒 CHECK SUBSCRIPTION LIMIT FOR CALL MINUTES (skip for CompanySync)
        if (companyId) {
            const company = await base44.asServiceRole.entities.Company.filter({ id: companyId });
            const isCompanySync = company?.length > 0 && company[0].company_name === 'CompanySync';
            
            if (!isCompanySync) {
                try {
                    // Check if subscription usage exists first
                    const usageRecords = await base44.asServiceRole.entities.SubscriptionUsage.filter({ company_id: companyId });
                    
                    if (usageRecords.length > 0) {
                        const usage = usageRecords[0];
                        const available = (usage.call_minutes_limit || 0) - (usage.call_minutes_used || 0) + (usage.call_credits_purchased || 0);
                        
                        if (usage.plan_name !== 'unlimited' && available < 1) {
                            return Response.json({ 
                                error: `Call limit exceeded. Upgrade your plan to make more calls.`,
                                remaining: 0
                            }, { status: 429 });
                        }
                    }
                    // If no subscription usage exists, allow the call (legacy/trial behavior)
                } catch (limitErr) {
                    console.error('Error checking call limit, allowing call:', limitErr);
                    // If limit check fails, allow the call to proceed
                }
            }
        }

        // --- CREDENTIAL RESOLUTION LOGIC ---

        // 1. Get System Environment Variables (Secrets)
        const envSid = Deno.env.get("TWILIO_ACCOUNT_SID");
        const envToken = Deno.env.get("TWILIO_AUTH_TOKEN");
        const envPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

        // 2. Get Database Settings
        let dbSettings = null;
        let targetCompanyId = companyId;
        
        if (!targetCompanyId) {
            // Check StaffProfile first
            const staff = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
            if (staff?.length > 0 && staff[0].company_id) {
                targetCompanyId = staff[0].company_id;
            } else {
                 const companies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
                 if (companies?.length > 0) targetCompanyId = companies[0].id;
            }
        }

        if (targetCompanyId) {
            const settings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: targetCompanyId });
            if (settings?.length > 0) dbSettings = settings[0];
        }

        // 3. Helper to sanitize and validate SID
        const clean = (val) => val ? String(val).trim().replace(/["']/g, '') : '';
        const isValidSid = (sid) => clean(sid).startsWith('AC');

        // 4. Select Best Credentials
        let finalSid = '';
        let finalToken = '';
        let finalPhone = '';
        let source = '';

        // Priority 1: Valid DB Settings
        if (dbSettings && isValidSid(dbSettings.account_sid) && dbSettings.auth_token) {
            finalSid = clean(dbSettings.account_sid);
            finalToken = clean(dbSettings.auth_token);
            finalPhone = clean(dbSettings.main_phone_number);
            
            if (!dbSettings.enable_calling) {
                return Response.json({ error: 'Calling is disabled in your Company Settings.' }, { status: 400 });
            }
            source = 'database';
        }

        // 5. Final Validation
        if (!finalSid.startsWith('AC')) {
            console.error('❌ Invalid SID:', finalSid, 'Source:', source, 'DB Raw:', dbSettings?.account_sid);
            return Response.json({ 
                error: `Twilio is not configured for this company. Please go to Communication Hub -> Settings and enter your Twilio credentials.` 
            }, { status: 500 });
        }

        if (!finalToken) {
            return Response.json({ error: 'Twilio Configuration Error: Missing Auth Token.' }, { status: 500 });
        }

        if (!finalPhone) {
            return Response.json({ error: 'Twilio Configuration Error: Missing Phone Number.' }, { status: 500 });
        }

        console.log(`✅ Using Twilio credentials from: ${source}`);

        // --- END CREDENTIAL RESOLUTION ---

        // Get User Phone
        let userPhone = null;
        const userProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
        if (userProfiles?.length > 0) userPhone = userProfiles[0].phone;
        
        if (!userPhone) {
            const userEntity = await base44.asServiceRole.entities.User.filter({ email: user.email });
            if (userEntity?.length > 0) userPhone = userEntity[0].phone;
        }

        if (!userPhone) {
            return Response.json({ error: 'Your phone number is not set. Please add it in your profile.' }, { status: 400 });
        }

        // Format Numbers
        const formatE164 = (p) => {
            if (!p) return null;
            let c = p.replace(/\D/g, '');
            if (c.length === 10) return '+1' + c;
            if (c.length === 11 && c.startsWith('1')) return '+' + c;
            return '+' + c;
        };

        const fromNumber = formatE164(finalPhone);
        const userNumber = formatE164(userPhone);
        const leadNumber = formatE164(to);

        if (userNumber === fromNumber) {
            return Response.json({ error: 'Your phone number cannot be the same as the company number. Please update it.' }, { status: 400 });
        }

        // Initiate Call
        const client = twilio(finalSid, finalToken);
        const baseUrl = new URL(req.url).origin;

        // Fetch company name for TwiML
        let companyName = "Our Company";
        if (targetCompanyId) {
            const c = await base44.asServiceRole.entities.Company.filter({ id: targetCompanyId });
            if (c?.[0]) companyName = c[0].company_name;
        }

        const twiml = `<Response>
            <Say>This is Sarah of Companysync. Connecting you to ${contactName || 'the customer'}.</Say>
            <Dial callerId="${fromNumber}" record="record-from-answer-dual">
                <Number>${leadNumber}</Number>
            </Dial>
        </Response>`;

        console.log('📞 CALL DETAILS:');
        console.log('  From (Twilio):', fromNumber);
        console.log('  To (Your Phone):', userNumber);
        console.log('  Lead Number:', leadNumber);
        console.log('  Contact Name:', contactName);

        const call = await client.calls.create({
            from: fromNumber,
            to: userNumber,
            twiml: twiml,
            statusCallback: `${baseUrl}/api/functions/callStatusWebhook`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
            statusCallbackMethod: 'POST'
        });

        console.log('✅ Twilio Response:', JSON.stringify({
            sid: call.sid,
            status: call.status,
            from: call.from,
            to: call.to
        }));

        // Log
        if (targetCompanyId) {
            await base44.asServiceRole.entities.Communication.create({
                company_id: targetCompanyId,
                contact_name: contactName || 'Unknown',
                contact_phone: leadNumber,
                communication_type: 'call',
                direction: 'outbound',
                subject: `Outbound Call to ${contactName || 'Unknown'}`,
                message: `Call initiated by ${user.full_name}. Recording enabled.`,
                twilio_sid: call.sid,
                status: 'initiated',
                created_by: user.email
            });

            // ✅ UPDATE USAGE AFTER SUCCESSFUL CALL INITIATION (skip for CompanySync)
            const company = await base44.asServiceRole.entities.Company.filter({ id: targetCompanyId });
            const isCompanySync = company?.length > 0 && company[0].company_name === 'CompanySync';
            
            if (!isCompanySync) {
                try {
                    const usageRecords = await base44.asServiceRole.entities.SubscriptionUsage.filter({ company_id: targetCompanyId });
                    if (usageRecords.length > 0) {
                        await base44.asServiceRole.entities.SubscriptionUsage.update(usageRecords[0].id, {
                            call_minutes_used: (usageRecords[0].call_minutes_used || 0) + 1
                        });
                    }
                } catch (usageErr) {
                    console.error('Failed to update call usage:', usageErr);
                }
            }
        }

        return Response.json({
            success: true,
            message: `Calling your phone (${userPhone})...`,
            sid: call.sid
        });

    } catch (error) {
        console.error('💥 makeCall Error:', error);
        return Response.json({ 
            error: error.message || 'Failed to make call',
            details: error.code ? `Twilio Code: ${error.code}` : undefined
        }, { status: 500 });
    }
});