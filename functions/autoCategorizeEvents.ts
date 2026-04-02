import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

const EVENT_TYPE_COLORS = {
  meeting: '#3b82f6',
  inspection: '#10b981',
  call: '#8b5cf6',
  appointment: '#f59e0b',
  reminder: '#eab308',
  estimate: '#06b6d4',
  roofing_contractor: '#14b8a6',
  follow_up: '#ec4899',
  check_pickup: '#f97316',
  other: '#6b7280'
};

function detectEventType(title, description) {
    if (!title) return 'meeting';
    
    const titleLower = title.toLowerCase();
    const descLower = (description || '').toLowerCase();

    if (titleLower.includes('inspection') || titleLower.includes('inspect')) return 'inspection';
    if (titleLower.includes('call') && !titleLower.includes('recall')) return 'call';
    if (titleLower.includes('follow up') || titleLower.includes('follow-up')) return 'follow_up';
    if (titleLower.includes('reminder') || titleLower.includes('birthday') || titleLower.includes('decompress')) return 'reminder';
    if (titleLower.includes('pickup') || titleLower.includes('transfer title')) return 'check_pickup';
    if (titleLower.includes('estimate')) return 'estimate';
    if (titleLower.includes('roofing contractor')) return 'roofing_contractor';
    if (titleLower.includes('appointment')) return 'appointment';

    return 'meeting';
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🎨 Starting categorization for:', user.email);

        // Get company ID
        let companyId = null;
        
        const ownedCompanies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
        if (ownedCompanies.length > 0) {
            companyId = ownedCompanies[0].id;
        } else {
            const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
            if (staffProfiles.length > 0) {
                companyId = staffProfiles[0].company_id;
            }
        }

        if (!companyId) {
            return Response.json({ 
                error: 'No company found. Please complete setup first.' 
            }, { status: 400 });
        }

        console.log('✅ Using company ID:', companyId);

        // Get ALL events for the company
        const allEvents = await base44.asServiceRole.entities.CalendarEvent.filter({ 
            company_id: companyId
        });

        console.log(`Found ${allEvents.length} total events for company`);

        let updated = 0;
        let unchanged = 0;

        for (const event of allEvents) {
            const detectedType = detectEventType(event.title, event.description);
            const newColor = EVENT_TYPE_COLORS[detectedType];

            if (event.event_type !== detectedType || event.color !== newColor) {
                await base44.asServiceRole.entities.CalendarEvent.update(event.id, {
                    event_type: detectedType,
                    color: newColor
                });
                updated++;
                console.log(`✓ Updated: ${event.title} -> ${detectedType}`);
            } else {
                unchanged++;
            }
        }

        console.log(`✅ Done: ${updated} updated, ${unchanged} unchanged`);

        return Response.json({
            success: true,
            total: allEvents.length,
            updated,
            unchanged
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return Response.json({ 
            error: error.message,
            details: error.stack
        }, { status: 500 });
    }
});