import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let payload = {};
        try { payload = await req.json(); } catch (e) {}

        // 1. Get User's Company
        let companyId = payload.companyId;

        if (!companyId) {
            // Fallback to first company found (legacy behavior)
            const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
            if (!staffProfiles.length) {
                return Response.json({ error: 'No staff profile found' }, { status: 404 });
            }
            companyId = staffProfiles[0].company_id;
        } else {
            // Verify access to the requested company
            const access = await base44.entities.StaffProfile.filter({ user_email: user.email, company_id: companyId });
            if (!access.length) return Response.json({ error: 'Unauthorized for this company' }, { status: 403 });
        }

        // 2. Construct Booking URL
        let appUrl = Deno.env.get("APP_URL");
        if (!appUrl) {
            // Fallback if APP_URL is not set (though it should be)
             return Response.json({ error: 'APP_URL secret not set' }, { status: 500 });
        }
        
        // Ensure https://
        if (!appUrl.startsWith('http')) {
            appUrl = `https://${appUrl}`;
        }
        // Remove trailing slash
        if (appUrl.endsWith('/')) {
            appUrl = appUrl.slice(0, -1);
        }

        const bookingUrl = `${appUrl}/BookAppointment?company_id=${companyId}`;
        console.log('🔗 Generated Booking URL:', bookingUrl);

        // 3. Update AssistantSettings
        const existingSettings = await base44.entities.AssistantSettings.filter({ 
            company_id: companyId,
            assistant_name: 'sarah'
        });

        let settings;
        if (existingSettings.length > 0) {
            // Update
            settings = await base44.entities.AssistantSettings.update(existingSettings[0].id, {
                calendly_booking_url: bookingUrl
            });
            console.log('✅ Updated existing settings');
        } else {
            // Create
            settings = await base44.entities.AssistantSettings.create({
                company_id: companyId,
                assistant_name: 'sarah',
                calendly_booking_url: bookingUrl,
                engine: 'gemini-2.0-flash', // Default engine
                voice_enabled: true
            });
            console.log('✅ Created new settings');
        }

        return Response.json({ 
            success: true, 
            booking_url: bookingUrl,
            settings: settings 
        });

    } catch (error) {
        console.error('Error configuring booking link:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});