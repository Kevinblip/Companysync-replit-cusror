import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔧 Marking all pre-October 2025 invoices as paid...');

        // Get all invoices before October 2025 that aren't already paid or cancelled
        const oldInvoices = await base44.asServiceRole.entities.Invoice.list('-created_date', 10000);
        
        const unpaidOldInvoices = oldInvoices.filter(inv => {
            if (!inv.issue_date) return false;
            if (inv.status === 'paid' || inv.status === 'cancelled') return false;
            
            const issueDate = new Date(inv.issue_date);
            const oct2025 = new Date('2025-10-01');
            
            return issueDate < oct2025;
        });

        console.log(`📋 Found ${unpaidOldInvoices.length} old unpaid invoices to mark as paid`);

        let updated = 0;
        const errors = [];

        // Process in batches of 10
        for (let i = 0; i < unpaidOldInvoices.length; i += 10) {
            const batch = unpaidOldInvoices.slice(i, i + 10);
            
            await Promise.all(batch.map(async (invoice) => {
                try {
                    await base44.asServiceRole.entities.Invoice.update(invoice.id, {
                        status: 'paid',
                        amount_paid: invoice.amount || 0
                    });
                    updated++;
                    console.log(`✅ ${invoice.invoice_number}: paid`);
                } catch (error) {
                    console.error(`❌ Failed ${invoice.invoice_number}:`, error.message);
                    errors.push({ invoice: invoice.invoice_number, error: error.message });
                }
            }));
            
            // Delay between batches
            if (i + 10 < unpaidOldInvoices.length) {
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }

        console.log(`✅ Marked ${updated} old invoices as paid`);

        return Response.json({
            success: true,
            updated_count: updated,
            total_found: unpaidOldInvoices.length,
            errors: errors
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});