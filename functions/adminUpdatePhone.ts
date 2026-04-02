import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const { email, phone } = await req.json();

        if (!email || !phone) return Response.json({ error: 'Missing email or phone' });

        // Find user by email
        const users = await base44.asServiceRole.entities.User.filter({ email });
        
        if (users.length === 0) {
            return Response.json({ message: 'User not found' });
        }

        const user = users[0];
        
        // Update user phone
        await base44.asServiceRole.entities.User.update(user.id, { phone });

        return Response.json({ 
            success: true, 
            message: `Updated phone for ${email} (${user.id}) to ${phone}`,
            old_phone: user.phone
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});