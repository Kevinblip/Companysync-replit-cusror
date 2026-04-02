import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Check authentication
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔄 Starting payment customer_id backfill...');

        // Get all payments
        const payments = await base44.asServiceRole.entities.Payment.list('', 10000);
        console.log(`📊 Found ${payments.length} total payments`);

        // Get all customers
        const customers = await base44.asServiceRole.entities.Customer.list('', 10000);
        console.log(`📊 Found ${customers.length} total customers`);

        let updatedCount = 0;
        let matchedCount = 0;
        let noMatchCount = 0;
        const errors = [];

        for (const payment of payments) {
            // Skip if already has customer_id
            if (payment.customer_id) {
                continue;
            }

            // Try to match by customer_name (exact match, case-insensitive)
            let matchedCustomer = null;
            
            if (payment.customer_name) {
                matchedCustomer = customers.find(c => 
                    c.name?.toLowerCase().trim() === payment.customer_name.toLowerCase().trim()
                );
            }

            if (matchedCustomer) {
                try {
                    await base44.asServiceRole.entities.Payment.update(payment.id, {
                        customer_id: matchedCustomer.id
                    });
                    matchedCount++;
                    updatedCount++;
                    console.log(`✅ Matched payment ${payment.payment_number || payment.id} → Customer: ${matchedCustomer.name}`);
                } catch (error) {
                    errors.push({
                        payment_id: payment.id,
                        payment_number: payment.payment_number,
                        error: error.message
                    });
                    console.error(`❌ Failed to update payment ${payment.id}:`, error);
                }
            } else {
                noMatchCount++;
                console.log(`⚠️ No match found for payment: ${payment.customer_name}`);
            }
        }

        const summary = {
            total_payments: payments.length,
            already_had_customer_id: payments.length - (matchedCount + noMatchCount),
            successfully_matched: matchedCount,
            no_match_found: noMatchCount,
            total_updated: updatedCount,
            errors: errors.length,
            error_details: errors
        };

        console.log('✅ Backfill complete:', summary);

        return Response.json({
            success: true,
            summary
        });

    } catch (error) {
        console.error('❌ Payment backfill error:', error);
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});