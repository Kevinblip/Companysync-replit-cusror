import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔧 Recalculating invoice statuses from actual Payment records...');

        // Get all invoices and payments
        const invoices = await base44.asServiceRole.entities.Invoice.list('-created_date', 10000);
        const allPayments = await base44.asServiceRole.entities.Payment.list('-created_date', 10000);
        
        console.log(`📋 Found ${invoices.length} invoices and ${allPayments.length} payments`);

        let fixed = 0;
        let alreadyCorrect = 0;
        const fixes = [];

        for (const invoice of invoices) {
            const invoiceAmount = invoice.amount || 0;
            const currentStatus = invoice.status;
            const currentAmountPaid = invoice.amount_paid || 0;

            // Skip cancelled invoices
            if (currentStatus === 'cancelled') {
                alreadyCorrect++;
                continue;
            }

            // Calculate ACTUAL amount paid from Payment records
            const relatedPayments = allPayments.filter(p => 
                (p.invoice_number === invoice.invoice_number || p.invoice_id === invoice.id) &&
                p.status === 'received'
            );
            
            const actualAmountPaid = relatedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);

            // Determine correct status
            let correctStatus = currentStatus;
            
            if (actualAmountPaid === 0) {
                // No payments received
                if (currentStatus === 'paid' || currentStatus === 'partially_paid') {
                    correctStatus = 'sent';
                } else {
                    correctStatus = currentStatus || 'draft';
                }
            } else if (actualAmountPaid >= invoiceAmount) {
                // Fully paid
                correctStatus = 'paid';
            } else if (actualAmountPaid > 0) {
                // Partially paid
                correctStatus = 'partially_paid';
            }

            // Check if update needed
            const needsUpdate = correctStatus !== currentStatus || 
                               Math.abs(actualAmountPaid - currentAmountPaid) > 0.01;

            if (needsUpdate) {
                await base44.asServiceRole.entities.Invoice.update(invoice.id, {
                    amount_paid: actualAmountPaid,
                    status: correctStatus
                });
                fixed++;
                fixes.push({
                    invoice_number: invoice.invoice_number,
                    customer: invoice.customer_name,
                    invoice_total: invoiceAmount,
                    was_paid: currentAmountPaid,
                    actual_paid: actualAmountPaid,
                    was_status: currentStatus,
                    now_status: correctStatus,
                    payment_count: relatedPayments.length
                });
                console.log(`✅ ${invoice.invoice_number}: $${currentAmountPaid} → $${actualAmountPaid}, ${currentStatus} → ${correctStatus}`);
            } else {
                alreadyCorrect++;
            }
        }

        console.log(`✅ Fixed ${fixed} invoices, ${alreadyCorrect} already correct`);

        return Response.json({
            success: true,
            total_invoices: invoices.length,
            fixed_count: fixed,
            already_correct: alreadyCorrect,
            fixes: fixes
        });

    } catch (error) {
        console.error('❌ Fix error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});