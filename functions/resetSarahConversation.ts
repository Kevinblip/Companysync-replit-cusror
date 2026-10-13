import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Verify admin user
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { phone_number } = await req.json();
        
        if (!phone_number) {
            return Response.json({ error: 'phone_number required' }, { status: 400 });
        }

        console.log('🔄 Resetting Sarah conversation for:', phone_number);

        // Delete all "Sarah Cap" messages for this phone number
        const capMessages = await base44.asServiceRole.entities.Communication.filter({
            contact_phone: phone_number,
            subject: 'Sarah Cap',
            direction: 'outbound'
        });

        let deleted = 0;
        for (const msg of capMessages) {
            await base44.asServiceRole.entities.Communication.delete(msg.id);
            deleted++;
        }

        console.log(`✅ Deleted ${deleted} cap messages`);

        return Response.json({ 
            success: true, 
            message: `Conversation reset for ${phone_number}`,
            deleted_messages: deleted
        });

    } catch (error) {
        console.error('❌ Reset error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});