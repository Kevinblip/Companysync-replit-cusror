import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Only payments with these statuses count toward invoice settlement.
// Pending and processing payments are excluded — they have not been confirmed received.
const SETTLED_STATUSES = new Set(['received']);

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { invoice_number, invoice_id } = body;

        if (!invoice_number && !invoice_id) {
            return Response.json({ error: 'invoice_number or invoice_id required' }, { status: 400 });
        }

        console.log('🔄 Recalculating payments for invoice:', invoice_number || invoice_id);

        // invoice id decides which row is recalculated. A number is accepted
        // only when it belongs to exactly one invoice.
        let invoice: any = null;

        if (invoice_id) {
            const invoices = await base44.asServiceRole.entities.Invoice.filter({ id: invoice_id });
            if (invoices.length > 0) invoice = invoices[0];
        } else if (invoice_number) {
            const invoices = await base44.asServiceRole.entities.Invoice.filter({ invoice_number });
            if (invoices.length !== 1) {
                return Response.json({
                    error: invoices.length === 0
                        ? 'Invoice not found'
                        : `Invoice number ${invoice_number} matches ${invoices.length} invoices. Recalculate by invoice id.`,
                }, { status: invoices.length === 0 ? 404 : 409 });
            }
            invoice = invoices[0];
        }

        if (!invoice) {
            return Response.json({ error: 'Invoice not found' }, { status: 404 });
        }

        const resolvedInvoiceNumber = invoice.invoice_number;

        const allPayments: any[] = [];
        const seenPaymentIds = new Set<string>();

        const addIfSettled = (p: any) => {
            if (!seenPaymentIds.has(p.id) && SETTLED_STATUSES.has(p.status || '')) {
                allPayments.push(p);
                seenPaymentIds.add(p.id);
            }
        };

        if (invoice.id) {
            const byId = await base44.asServiceRole.entities.Payment.filter({
                invoice_id: invoice.id,
                status: 'received'
            });
            byId.forEach(addIfSettled);
        }

        // Legacy rows stored only a number. Count them only when this invoice
        // is the unique holder of that number, and the payment has no id.
        if (resolvedInvoiceNumber) {
            const holders = await base44.asServiceRole.entities.Invoice.filter({ invoice_number: resolvedInvoiceNumber });
            if (holders.length === 1 && holders[0].id === invoice.id) {
                const byNumber = await base44.asServiceRole.entities.Payment.filter({
                    invoice_number: resolvedInvoiceNumber,
                    status: 'received'
                });
                byNumber.forEach((p: any) => {
                    if (!p.invoice_id) addIfSettled(p);
                });
            }
        }

        // Sum only settled payments
        const totalPaid = allPayments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
        const invoiceAmount = Number(invoice.amount || invoice.total_amount || 0);

        // Determine new status (mirrors computeInvoiceRecalcState in paymentGuards.js)
        let newStatus: string;
        if (totalPaid <= 0) {
            newStatus = ['draft', 'cancelled', 'void'].includes(invoice.status) ? invoice.status : 'sent';
        } else if (invoiceAmount > 0 && totalPaid >= invoiceAmount) {
            newStatus = 'paid';
        } else {
            newStatus = 'partially_paid';
        }

        // Persist the recalculated totals
        await base44.asServiceRole.entities.Invoice.update(invoice.id, {
            amount_paid: totalPaid,
            status: newStatus
        });

        console.log(`✅ Invoice ${resolvedInvoiceNumber} recalculated:`);
        console.log(`   Payments found: ${allPayments.length}`);
        console.log(`   Total paid: $${totalPaid.toFixed(2)}`);
        console.log(`   New status: ${newStatus}`);

        return Response.json({
            success: true,
            invoice_number: resolvedInvoiceNumber,
            payments_count: allPayments.length,
            total_paid: totalPaid,
            new_status: newStatus,
            payments: allPayments.map((p: any) => ({
                payment_number: p.payment_number,
                amount: p.amount,
                date: p.payment_date
            }))
        });

    } catch (error: any) {
        console.error('❌ Error:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});
