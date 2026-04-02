import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔄 Starting payment_number backfill...');

        const payments = await base44.asServiceRole.entities.Payment.list('-created_date', 10000);
        console.log(`📊 Found ${payments.length} total payments`);

        let updatedCount = 0;
        const errors = [];

        // Sort by created_date to assign numbers in order
        const sortedPayments = [...payments].sort((a, b) => {
            const dateA = a.created_date ? new Date(a.created_date).getTime() : 0;
            const dateB = b.created_date ? new Date(b.created_date).getTime() : 0;
            return dateA - dateB;
        });

        // Determine starting number from existing payments
        const existingNumbers = payments
            .map(p => p.payment_number)
            .filter(num => num && num.startsWith('PAY-'))
            .map(num => parseInt(num.replace(/PAY-\d{4}-|[^\d]/g, '')))
            .filter(num => !isNaN(num));
        
        let maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;

        for (let i = 0; i < sortedPayments.length; i++) {
            const payment = sortedPayments[i];
            
            // Skip if already has payment_number
            if (payment.payment_number) {
                continue;
            }

            try {
                maxNumber++;
                // Use creation year for the payment number, or default to current year if date invalid
                const paymentDate = new Date(payment.created_date);
                const year = !isNaN(paymentDate.getTime()) ? paymentDate.getFullYear() : new Date().getFullYear();
                
                const paymentNumber = `PAY-${year}-${String(maxNumber).padStart(4, '0')}`;
                
                await base44.asServiceRole.entities.Payment.update(payment.id, {
                    payment_number: paymentNumber
                });
                updatedCount++;
                console.log(`✅ Assigned ${paymentNumber} to payment for ${payment.customer_name}`);
            } catch (error) {
                errors.push({
                    payment_id: payment.id,
                    customer_name: payment.customer_name,
                    error: error.message
                });
                console.error(`❌ Failed to update payment ${payment.id}:`, error);
            }
        }

        const summary = {
            total_payments: payments.length,
            already_had_number: payments.filter(p => p.payment_number).length,
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
        console.error('❌ Payment number backfill error:', error);
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});