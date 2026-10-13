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

        // Get invoice — try invoice_number first, then invoice_id as fallback
        let invoice: any = null;

        if (invoice_number) {
            const invoices = await base44.asServiceRole.entities.Invoice.filter({ invoice_number });
            if (invoices.length > 0) invoice = invoices[0];
        }

        if (!invoice && invoice_id) {
            const invoices = await base44.asServiceRole.entities.Invoice.filter({ id: invoice_id });
            if (invoices.length > 0) invoice = invoices[0];
        }

        if (!invoice) {
            return Response.json({ error: 'Invoice not found' }, { status: 404 });
        }

        const resolvedInvoiceNumber = invoice.invoice_number;

        // Collect all RECEIVED payments for this invoice (deduped)
        const allPayments: any[] = [];
        const seenPaymentIds = new Set<string>();

        const addIfSettled = (p: any) => {
            if (!seenPaymentIds.has(p.id) && SETTLED_STATUSES.has(p.status || '')) {
                allPayments.push(p);
                seenPaymentIds.add(p.id);
            }
        };

        // 1. Find by exact invoice_number
        if (resolvedInvoiceNumber) {
            const byNumber = await base44.asServiceRole.entities.Payment.filter({
                invoice_number: resolvedInvoiceNumber,
                status: 'received'
            });
            byNumber.forEach(addIfSettled);
        }

        // 2. Find by invoice_id (catches payments linked by ID but with a mismatched invoice_number)
        if (invoice.id) {
            const byId = await base44.asServiceRole.entities.Payment.filter({
                invoice_id: invoice.id,
                status: 'received'
            });
            byId.forEach(addIfSettled);
        }

        // 3. Fuzzy match by trimmed invoice_number (handles whitespace/casing drift)
        if (resolvedInvoiceNumber) {
            const cleanInvoiceNum = resolvedInvoiceNumber.trim().toLowerCase();
            const allReceived = await base44.asServiceRole.entities.Payment.filter({ status: 'received' });
            allReceived.forEach((p: any) => {
                if (p.invoice_number &&
                    p.invoice_number.trim().toLowerCase() === cleanInvoiceNum) {
                    addIfSettled(p);
                }
            });
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
