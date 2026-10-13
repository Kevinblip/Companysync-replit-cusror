import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Authenticate user
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const {
            user_email,
            title,
            message,
            type = 'general',
            related_entity_type,
            related_entity_id,
            link_url,
            company_id
        } = body;

        // Validate required fields
        if (!user_email || !title || !message) {
            return Response.json({ 
                error: 'Missing required fields: user_email, title, message' 
            }, { status: 400 });
        }

        // Create notification
        const notification = await base44.asServiceRole.entities.Notification.create({
            company_id: company_id || null,
            user_email,
            title,
            message,
            type,
            related_entity_type: related_entity_type || null,
            related_entity_id: related_entity_id || null,
            link_url: link_url || null,
            is_read: false
        });

        console.log('✅ Notification created:', notification.id, 'for', user_email);

        return Response.json({ 
            success: true, 
            notification_id: notification.id 
        });

    } catch (error) {
        console.error('❌ Create Notification Error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});