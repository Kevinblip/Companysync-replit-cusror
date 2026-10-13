import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { payment_id, company_id } = await req.json();

        if (!payment_id || !company_id) {
            return Response.json({ error: 'payment_id and company_id required' }, { status: 400 });
        }

        console.log('💰 Family Commission - Processing payment:', payment_id);

        // Get payment details
        const payments = await base44.asServiceRole.entities.Payment.filter({ id: payment_id });
        if (!payments || payments.length === 0) {
            return Response.json({ error: 'Payment not found' }, { status: 404 });
        }

        const payment = payments[0];
        const saleAmount = payment.amount;

        // Get active family members
        const familyMembers = await base44.asServiceRole.entities.FamilyMember.filter({
            company_id: company_id,
            is_active: true
        });

        if (!familyMembers || familyMembers.length === 0) {
            console.log('ℹ️ No active family members found, skipping commission');
            return Response.json({ 
                success: true, 
                message: 'No active family members, commission skipped' 
            });
        }

        // Check if commission already distributed for this payment
        const existing = await base44.asServiceRole.entities.FamilyCommissionRecord.filter({
            payment_id: payment_id
        });

        if (existing && existing.length > 0) {
            console.log('ℹ️ Commission already distributed for this payment');
            return Response.json({ 
                success: true, 
                message: 'Commission already distributed' 
            });
        }

        // Sort by last_commission_date (oldest first = next in line)
        familyMembers.sort((a, b) => {
            const dateA = a.last_commission_date ? new Date(a.last_commission_date) : new Date(0);
            const dateB = b.last_commission_date ? new Date(b.last_commission_date) : new Date(0);
            return dateA - dateB;
        });

        // Get next family member (round-robin)
        const nextMember = familyMembers[0];
        const commissionPercentage = nextMember.commission_percentage || 0.5;
        const commissionAmount = (saleAmount * commissionPercentage) / 100;

        console.log(`✅ Awarding ${commissionPercentage}% ($${commissionAmount.toFixed(2)}) to ${nextMember.full_name}`);

        // Create commission record
        await base44.asServiceRole.entities.FamilyCommissionRecord.create({
            company_id: company_id,
            family_member_id: nextMember.id,
            family_member_name: nextMember.full_name,
            invoice_id: payment.invoice_id,
            invoice_number: payment.invoice_number,
            payment_id: payment.id,
            customer_name: payment.customer_name,
            sale_amount: saleAmount,
            commission_percentage: commissionPercentage,
            commission_amount: commissionAmount,
            payment_date: payment.payment_date,
            status: 'pending'
        });

        // Update family member stats
        await base44.asServiceRole.entities.FamilyMember.update(nextMember.id, {
            total_earned: (nextMember.total_earned || 0) + commissionAmount,
            last_commission_date: new Date().toISOString()
        });

        // Send notification to family member if email exists
        if (nextMember.email) {
            await base44.asServiceRole.entities.Notification.create({
                company_id: company_id,
                user_email: nextMember.email,
                title: '💰 Commission Earned!',
                message: `You earned $${commissionAmount.toFixed(2)} (${commissionPercentage}%) from ${payment.customer_name}'s payment of $${saleAmount.toFixed(2)}`,
                type: 'general',
                icon: 'dollar-sign'
            });
        }

        return Response.json({
            success: true,
            commission_amount: commissionAmount,
            recipient: nextMember.full_name,
            message: `Commission of $${commissionAmount.toFixed(2)} awarded to ${nextMember.full_name}`
        });

    } catch (error) {
        console.error('❌ Family Commission Error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});