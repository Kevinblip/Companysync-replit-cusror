import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { invoice_number } = await req.json();

        if (!invoice_number) {
            return Response.json({ error: 'invoice_number required' }, { status: 400 });
        }

        console.log('🔄 Recalculating payments for invoice:', invoice_number);

        // Get invoice
        const invoices = await base44.asServiceRole.entities.Invoice.filter({ invoice_number });
        if (invoices.length === 0) {
            return Response.json({ error: 'Invoice not found' }, { status: 404 });
        }

        const invoice = invoices[0];

        // --- Aggressive Payment Finding ---
        const allPayments = [];
        const seenPaymentIds = new Set();

        // 1. Find by exact invoice_number
        const byNumber = await base44.asServiceRole.entities.Payment.filter({ 
            invoice_number: invoice_number,
            status: 'received'
        });
        byNumber.forEach(p => {
            if (!seenPaymentIds.has(p.id)) {
                allPayments.push(p);
                seenPaymentIds.add(p.id);
            }
        });

        // 2. Find by invoice_id
        if (invoice.id) {
            const byId = await base44.asServiceRole.entities.Payment.filter({
                invoice_id: invoice.id,
                status: 'received'
            });
            byId.forEach(p => {
                if (!seenPaymentIds.has(p.id)) {
                    allPayments.push(p);
                    seenPaymentIds.add(p.id);
                }
            });
        }

        // 3. Find by fuzzy/trimmed invoice_number (Robust fallback)
        // This is necessary because sometimes whitespace creeps in or casing differs
        const cleanInvoiceNum = invoice_number.trim().toLowerCase();
        // Since we can't filter by trimmed values in DB, we fetch broader set if needed or just fetch all received payments 
        // fetching all received payments might be heavy if there are thousands, but safer for consistency for now.
        // Or we can try to guess common variations.
        // For now, let's fetch all received payments for this customer if we have customer info, or just all received payments.
        // Getting all received payments is safest for small/medium scale apps.
        const allReceived = await base44.asServiceRole.entities.Payment.filter({ status: 'received' });
        
        allReceived.forEach(p => {
            if (!seenPaymentIds.has(p.id) && p.invoice_number) {
                if (p.invoice_number.trim().toLowerCase() === cleanInvoiceNum) {
                    allPayments.push(p);
                    seenPaymentIds.add(p.id);
                }
            }
        });

        const payments = allPayments;

        // Calculate total paid
        const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

        // Determine new status
        let newStatus = 'sent';
        if (totalPaid === 0) {
            newStatus = invoice.status === 'draft' ? 'draft' : 'sent';
        } else if (totalPaid >= invoice.amount) {
            newStatus = 'paid';
        } else {
            newStatus = 'partially_paid';
        }

        // Update invoice
        await base44.asServiceRole.entities.Invoice.update(invoice.id, {
            amount_paid: totalPaid,
            status: newStatus
        });

        console.log(`✅ Invoice ${invoice_number} recalculated:`);
        console.log(`   Payments found: ${payments.length}`);
        console.log(`   Total paid: $${totalPaid.toFixed(2)}`);
        console.log(`   New status: ${newStatus}`);

        return Response.json({
            success: true,
            invoice_number,
            payments_count: payments.length,
            total_paid: totalPaid,
            new_status: newStatus,
            payments: payments.map(p => ({
                payment_number: p.payment_number,
                amount: p.amount,
                date: p.payment_date
            }))
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});