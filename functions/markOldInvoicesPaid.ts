import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Allow both cron-token auth and logged-in user auth
        const authHeader = req.headers.get('Authorization');
        const cronToken = Deno.env.get('CRON_SECRET_TOKEN');
        const isCronAuth = cronToken && authHeader === `Bearer ${cronToken}`;

        if (!isCronAuth) {
            const user = await base44.auth.me();
            if (!user) {
                return Response.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        // Support optional companyId scoping (for per-company auto-trigger)
        let requestBody: { companyId?: string; dryRun?: boolean } = {};
        try {
            const cloned = req.clone();
            requestBody = await cloned.json();
        } catch { /* no body is fine */ }

        const { companyId, dryRun = false } = requestBody;
        const cutoffDate = new Date('2026-01-01');

        console.log(`🔧 Marking pre-2026 invoices as paid (cutoff: ${cutoffDate.toISOString()}, dryRun: ${dryRun}, companyId: ${companyId || 'all'})...`);

        // Fetch invoices — scoped to company if provided, otherwise all
        const allInvoices = companyId
            ? await base44.asServiceRole.entities.Invoice.filter({ company_id: companyId })
            : await base44.asServiceRole.entities.Invoice.list('-created_date', 10000);

        const unpaidOldInvoices = allInvoices.filter(inv => {
            if (inv.status === 'paid' || inv.status === 'cancelled') return false;
            // Use issue_date first, fall back to created_date
            const dateStr = inv.issue_date || inv.created_date;
            if (!dateStr) return false;
            const invoiceDate = new Date(dateStr);
            return invoiceDate < cutoffDate;
        });

        console.log(`📋 Found ${unpaidOldInvoices.length} pre-2026 unpaid invoices to mark as paid`);

        if (dryRun) {
            return Response.json({
                success: true,
                dry_run: true,
                total_found: unpaidOldInvoices.length,
                sample: unpaidOldInvoices.slice(0, 5).map(i => ({
                    id: i.id,
                    invoice_number: i.invoice_number,
                    issue_date: i.issue_date,
                    created_date: i.created_date,
                    amount: i.amount,
                    status: i.status,
                })),
            });
        }

        let updated = 0;
        const errors: { invoice: string; error: string }[] = [];

        // Process in batches of 10
        for (let i = 0; i < unpaidOldInvoices.length; i += 10) {
            const batch = unpaidOldInvoices.slice(i, i + 10);

            await Promise.all(batch.map(async (invoice) => {
                try {
                    await base44.asServiceRole.entities.Invoice.update(invoice.id, {
                        status: 'paid',
                        amount_paid: invoice.amount || 0,
                    });
                    updated++;
                    console.log(`✅ ${invoice.invoice_number || invoice.id}: marked paid`);
                } catch (error: any) {
                    console.error(`❌ Failed ${invoice.invoice_number}:`, error.message);
                    errors.push({ invoice: invoice.invoice_number || invoice.id, error: error.message });
                }
            }));

            // Brief delay between batches to avoid rate-limiting
            if (i + 10 < unpaidOldInvoices.length) {
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }

        console.log(`✅ Marked ${updated}/${unpaidOldInvoices.length} old invoices as paid`);

        return Response.json({
            success: true,
            updated_count: updated,
            total_found: unpaidOldInvoices.length,
            errors,
        });

    } catch (error: any) {
        console.error('❌ Error:', error);
        return Response.json({
            error: error.message,
            stack: error.stack,
        }, { status: 500 });
    }
});
