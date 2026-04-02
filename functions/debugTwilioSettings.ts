import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        // List all TwilioSettings
        const settings = await base44.asServiceRole.entities.TwilioSettings.list('-created_date', 50);
        
        // Also list Companies to match names
        const companies = await base44.asServiceRole.entities.Company.list('-created_date', 50);
        
        const result = settings.map(s => {
            const company = companies.find(c => c.id === s.company_id);
            return {
                companyName: company?.company_name,
                companyId: s.company_id,
                mainPhone: s.main_phone_number,
                thoughtlyPhone: s.thoughtly_phone,
                useThoughtly: s.use_thoughtly_ai
            };
        });

        return Response.json(result);
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});