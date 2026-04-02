import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔄 Starting customer_number backfill...');

        const customers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);
        console.log(`📊 Found ${customers.length} total customers`);

        let updatedCount = 0;
        const errors = [];

        // Sort by created_date to assign numbers in order
        const sortedCustomers = [...customers].sort((a, b) => 
            new Date(a.created_date).getTime() - new Date(b.created_date).getTime()
        );

        for (let i = 0; i < sortedCustomers.length; i++) {
            const customer = sortedCustomers[i];
            
            // Skip if already has customer_number
            if (customer.customer_number) {
                continue;
            }

            try {
                await base44.asServiceRole.entities.Customer.update(customer.id, {
                    customer_number: i + 1
                });
                updatedCount++;
                console.log(`✅ Assigned #${i + 1} to ${customer.name}`);
            } catch (error) {
                errors.push({
                    customer_id: customer.id,
                    customer_name: customer.name,
                    error: error.message
                });
                console.error(`❌ Failed to update customer ${customer.id}:`, error);
            }
        }

        const summary = {
            total_customers: customers.length,
            already_had_number: customers.filter(c => c.customer_number).length,
            successfully_assigned: updatedCount,
            errors: errors.length,
            error_details: errors
        };

        console.log('✅ Backfill complete:', summary);

        return Response.json({
            success: true,
            summary
        });

    } catch (error) {
        console.error('❌ Customer number backfill error:', error);
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});