import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔄 Starting payment sync...');

        // Get all received payments and all invoices
        const payments = await base44.asServiceRole.entities.Payment.filter({ status: 'received' });
        console.log(`Found ${payments.length} received payments`);

        const invoices = await base44.asServiceRole.entities.Invoice.list('-created_date', 10000);
        console.log(`Found ${invoices.length} total invoices`);

        // Build a quick lookup of paid totals by invoice (use both invoice_id and invoice_number for legacy data)
        const paidByInvoiceId = new Map();
        const paidByInvoiceNumber = new Map();
        for (const p of payments) {
            if (p.invoice_id) {
                paidByInvoiceId.set(p.invoice_id, (paidByInvoiceId.get(p.invoice_id) || 0) + (p.amount || 0));
            }
            if (p.invoice_number) {
                paidByInvoiceNumber.set(p.invoice_number, (paidByInvoiceNumber.get(p.invoice_number) || 0) + (p.amount || 0));
            }
        }

        let updatedCount = 0;
        const fixes = [];

        for (const inv of invoices) {
            const total = inv.amount || 0;
            const paidViaId = paidByInvoiceId.get(inv.id) || 0;
            const paidViaNumber = inv.invoice_number ? (paidByInvoiceNumber.get(inv.invoice_number) || 0) : 0;
            const actualPaid = Math.max(paidViaId, paidViaNumber); // prefer explicit id-link, fallback to number-link

            let correctStatus = inv.status || 'draft';
            if (actualPaid <= 0) {
                // keep as is unless incorrectly marked paid
                if (correctStatus === 'paid' || correctStatus === 'partially_paid') {
                    correctStatus = 'sent';
                }
            } else if (actualPaid >= total && total > 0) {
                correctStatus = 'paid';
            } else {
                correctStatus = 'partially_paid';
            }

            const needsUpdate = (Math.abs((inv.amount_paid || 0) - actualPaid) > 0.01) || (inv.status !== correctStatus);
            if (needsUpdate) {
                await base44.asServiceRole.entities.Invoice.update(inv.id, {
                    amount_paid: actualPaid,
                    status: correctStatus
                });
                updatedCount++;
                fixes.push({ invoice: inv.invoice_number, was_status: inv.status, now_status: correctStatus, was_paid: inv.amount_paid || 0, actual_paid: actualPaid });
            }
        }

        console.log(`✅ Sync complete: ${updatedCount} invoices updated`);

        return Response.json({
            success: true,
            updated: updatedCount,
            totalPayments: payments.length,
            totalInvoices: invoices.length,
            fixes
        });

    } catch (error) {
        console.error('❌ Sync error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});