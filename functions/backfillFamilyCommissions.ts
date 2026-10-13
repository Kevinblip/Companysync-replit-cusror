import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { company_id, month, year } = await req.json();

        if (!company_id) {
            return Response.json({ error: 'company_id required' }, { status: 400 });
        }

        console.log(`🔄 Backfilling family commissions for ${month}/${year}...`);

        // Get all payments (don't filter by company_id since many are null)
        const allPayments = await base44.asServiceRole.entities.Payment.list('-created_date', 10000);

        // Filter by month/year and status
        const targetPayments = allPayments.filter(p => {
            if (!p.payment_date) return false;
            if (p.status !== 'received') return false;
            const paymentDate = new Date(p.payment_date);
            const paymentMonth = paymentDate.getMonth() + 1; // 1-12
            const paymentYear = paymentDate.getFullYear();
            return paymentMonth === month && paymentYear === year;
        });

        console.log(`📋 Found ${targetPayments.length} payments in ${month}/${year}`);

        // Check if there are active family members
        const familyMembers = await base44.asServiceRole.entities.FamilyMember.filter({
            company_id: company_id,
            is_active: true
        });
        
        console.log(`👨‍👩‍👧‍👦 Found ${familyMembers.length} active family members`);

        if (familyMembers.length === 0) {
            return Response.json({
                success: false,
                error: 'No active family members found',
                total_payments: targetPayments.length
            });
        }

        // Check existing commission records (check all, not just by company_id)
        const allExistingRecords = await base44.asServiceRole.entities.FamilyCommissionRecord.list('-created_date', 10000);
        const existingPaymentIds = new Set(allExistingRecords.map(r => r.payment_id));
        const paymentsNeedingCommission = targetPayments.filter(p => !existingPaymentIds.has(p.id));

        console.log(`✅ ${paymentsNeedingCommission.length} payments need commission distribution (${existingPaymentIds.size} already have commission records)`);

        let successCount = 0;
        let errorCount = 0;
        const results = [];

        for (const payment of paymentsNeedingCommission) {
            try {
                console.log(`📤 Processing ${payment.payment_number} - $${payment.amount}...`);
                
                // Call distributeFamilyCommission for each payment
                const response = await base44.asServiceRole.functions.invoke('distributeFamilyCommission', {
                    payment_id: payment.id,
                    company_id: company_id
                });

                const result = response.data;
                
                if (result.success) {
                    successCount++;
                    results.push({
                        payment_number: payment.payment_number,
                        amount: payment.amount,
                        recipient: result.recipient,
                        commission: result.commission_amount
                    });
                    console.log(`✅ ${payment.payment_number}: $${payment.amount} → ${result.recipient} gets $${result.commission_amount}`);
                } else {
                    errorCount++;
                    console.error(`❌ Failed for ${payment.payment_number}:`, result);
                }
            } catch (error) {
                errorCount++;
                console.error(`❌ Error processing ${payment.payment_number}:`, error);
            }
        }

        console.log(`🎉 Backfill complete: ${successCount} success, ${errorCount} errors`);

        return Response.json({
            success: true,
            total_payments: targetPayments.length,
            already_had_commission: targetPayments.length - paymentsNeedingCommission.length,
            distributed: successCount,
            errors: errorCount,
            results: results
        });

    } catch (error) {
        console.error('❌ Backfill error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});