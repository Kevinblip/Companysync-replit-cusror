import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import twilio from 'npm:twilio@5.3.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 1. Find Company
        const companies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
        // Also check via staff profile if not owner
        let companyId = companies[0]?.id;
        
        if (!companyId) {
             const staff = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
             companyId = staff[0]?.company_id;
        }

        if (!companyId) {
            return Response.json({ 
                success: false, 
                message: 'No company found for user' 
            });
        }

        // 2. Get Twilio Settings
        const settings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: companyId });
        const twilioConfig = settings[0];

        if (!twilioConfig) {
            return Response.json({
                success: false,
                message: 'No Twilio settings found for this company.'
            });
        }

        if (!twilioConfig.account_sid || !twilioConfig.auth_token) {
             return Response.json({
                success: false,
                message: 'Twilio settings found but credentials (SID/Token) are missing.'
            });
        }

        // 3. Test Credentials
        const client = twilio(twilioConfig.account_sid, twilioConfig.auth_token);
        let apiStatus = 'unknown';
        let apiError = null;

        try {
            await client.api.accounts(twilioConfig.account_sid).fetch();
            apiStatus = 'connected';
        } catch (error) {
            apiStatus = 'failed';
            apiError = error.message;
        }

        // 4. Check Recent Failed SMS
        const recentFailed = await base44.asServiceRole.entities.Communication.filter({
            company_id: companyId,
            communication_type: 'sms',
            status: 'failed'
        }, '-created_date', 5);

        return Response.json({
            success: true,
            companyId,
            twilioSettings: {
                exists: true,
                hasSid: !!twilioConfig.account_sid,
                hasToken: !!twilioConfig.auth_token,
                mainNumber: twilioConfig.main_phone_number,
                enableSMS: twilioConfig.enable_sms
            },
            apiConnection: {
                status: apiStatus,
                error: apiError
            },
            recentFailures: recentFailed.map(f => ({
                to: f.contact_phone,
                date: f.created_date,
                error: f.error_message || 'Unknown error'
            }))
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});