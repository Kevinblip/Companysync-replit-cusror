import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔍 Finding duplicate customers...');

        const customers = await base44.asServiceRole.entities.Customer.list('', 10000);
        console.log(`📊 Analyzing ${customers.length} customers`);

        const duplicateGroups = [];
        const processed = new Set();

        for (const customer of customers) {
            if (processed.has(customer.id)) continue;

            const duplicates = customers.filter(c => {
                if (c.id === customer.id || processed.has(c.id)) return false;

                // Name match (exact, case-insensitive)
                const nameMatch = c.name?.toLowerCase().trim() === customer.name?.toLowerCase().trim();

                // Email match (exact, case-insensitive)
                const emailMatch = c.email && customer.email && 
                    c.email.toLowerCase() === customer.email.toLowerCase();

                // Phone match (any phone field matches)
                const phoneMatch = 
                    (c.phone && customer.phone && c.phone === customer.phone) ||
                    (c.phone && customer.phone_2 && c.phone === customer.phone_2) ||
                    (c.phone_2 && customer.phone && c.phone_2 === customer.phone) ||
                    (c.phone_2 && customer.phone_2 && c.phone_2 === customer.phone_2);

                return nameMatch || emailMatch || phoneMatch;
            });

            if (duplicates.length > 0) {
                const group = [customer, ...duplicates];
                
                // Mark all in this group as processed
                group.forEach(c => processed.add(c.id));

                duplicateGroups.push({
                    match_type: group.some(c => c.email === customer.email) ? 'email' : 
                                group.some(c => c.phone === customer.phone) ? 'phone' : 'name',
                    records: group.map(c => ({
                        id: c.id,
                        customer_number: c.customer_number,
                        name: c.name,
                        email: c.email || '',
                        phone: c.phone || '',
                        created_date: c.created_date,
                        is_active: c.is_active,
                        notes: c.notes || '',
                        assigned_to_users: c.assigned_to_users || []
                    })),
                    suggested_keeper: group.reduce((latest, current) => 
                        new Date(current.created_date) > new Date(latest.created_date) ? current : latest
                    ).id
                });
            }
        }

        const summary = {
            total_customers: customers.length,
            duplicate_groups_found: duplicateGroups.length,
            total_duplicates: duplicateGroups.reduce((sum, g) => sum + g.records.length - 1, 0),
            duplicate_groups: duplicateGroups.slice(0, 20) // First 20 groups
        };

        console.log('✅ Duplicate search complete:', summary);

        return Response.json({
            success: true,
            summary
        });

    } catch (error) {
        console.error('❌ Duplicate search error:', error);
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});