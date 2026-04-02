import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * Universal Admin Notification System
 * Notifies all administrators about important CRM events
 */
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const body = await req.json();
        const {
            company_id,
            title,
            message,
            type = 'general',
            related_entity_type,
            related_entity_id,
            link_url
        } = body;

        // Validate required fields
        if (!company_id || !title || !message) {
            return Response.json({ 
                error: 'Missing required fields: company_id, title, message' 
            }, { status: 400 });
        }

        // Get all administrators for this company
        const allStaff = await base44.asServiceRole.entities.StaffProfile.filter({ 
            company_id 
        });
        
        const admins = allStaff.filter(s => s.is_administrator === true);
        
        if (admins.length === 0) {
            console.log('⚠️ No administrators found for company:', company_id);
            return Response.json({ 
                success: true, 
                admins_notified: 0,
                message: 'No administrators found'
            });
        }

        // Create notification for each admin
        let notifiedCount = 0;
        for (const admin of admins) {
            try {
                await base44.asServiceRole.entities.Notification.create({
                    company_id,
                    user_email: admin.user_email,
                    title,
                    message,
                    type,
                    related_entity_type: related_entity_type || null,
                    related_entity_id: related_entity_id || null,
                    link_url: link_url || null,
                    is_read: false
                });
                notifiedCount++;
            } catch (e) {
                console.error(`Failed to notify admin ${admin.user_email}:`, e.message);
            }
        }

        console.log(`✅ Notified ${notifiedCount}/${admins.length} admin(s)`);

        return Response.json({ 
            success: true, 
            admins_notified: notifiedCount,
            total_admins: admins.length
        });

    } catch (error) {
        console.error('❌ Notify Admins Error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});