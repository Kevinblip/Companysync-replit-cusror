import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log(`🔧 Fixing Google Calendar events for user: ${user.email}`);

        // Get user's company
        const companies = await base44.asServiceRole.entities.Company.list('-created_date', 100);
        const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
        
        let companyId = null;
        
        // Check if user owns a company
        const ownedCompany = companies.find(c => c.created_by === user.email);
        if (ownedCompany) {
            companyId = ownedCompany.id;
        } else if (staffProfiles.length > 0) {
            companyId = staffProfiles[0].company_id;
        }

        if (!companyId) {
            return Response.json({ 
                error: 'No company found for user',
                suggestion: 'Please set up your company first in Company Setup'
            }, { status: 400 });
        }

        console.log(`✅ Found company_id: ${companyId}`);

        // Get all events assigned to this user
        const allEvents = await base44.asServiceRole.entities.CalendarEvent.filter({ 
            assigned_to: user.email 
        }, '-created_date', 1000);

        console.log(`📊 Found ${allEvents.length} events assigned to ${user.email}`);

        // Find events missing company_id
        const eventsNeedingFix = allEvents.filter(e => !e.company_id);
        
        console.log(`🔧 ${eventsNeedingFix.length} events need company_id`);

        // Fix each event
        let fixed = 0;
        for (const event of eventsNeedingFix) {
            await base44.asServiceRole.entities.CalendarEvent.update(event.id, {
                company_id: companyId
            });
            fixed++;
        }

        console.log(`✅ Fixed ${fixed} events`);

        return Response.json({
            success: true,
            company_id: companyId,
            total_events: allEvents.length,
            fixed: fixed,
            message: `✅ Successfully added company_id to ${fixed} events. Refresh your calendar!`
        });

    } catch (error) {
        console.error('❌ Error fixing events:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});