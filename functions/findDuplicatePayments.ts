import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔍 Scanning for duplicate payments...');

    const allPayments = await base44.asServiceRole.entities.Payment.list('-payment_date', 10000);
    console.log(`Found ${allPayments.length} total payments`);

    const currentYear = new Date().getFullYear();
    const currentYearPayments = allPayments.filter(p => {
      if (!p.payment_date) return false;
      return new Date(p.payment_date).getFullYear() === currentYear;
    });

    console.log(`${currentYearPayments.length} payments in ${currentYear}`);

    // Group by: customer + amount + date + reference
    const paymentGroups = {};
    
    currentYearPayments.forEach(payment => {
      const key = `${payment.customer_name || 'unknown'}-${payment.amount || 0}-${payment.payment_date || 'nodate'}-${payment.reference_number || 'noref'}`;
      
      if (!paymentGroups[key]) {
        paymentGroups[key] = [];
      }
      paymentGroups[key].push(payment);
    });

    // Find duplicates
    const duplicateGroups = Object.entries(paymentGroups)
      .filter(([key, payments]) => payments.length > 1)
      .map(([key, payments]) => ({
        customer: payments[0].customer_name,
        amount: payments[0].amount,
        payment_date: payments[0].payment_date,
        reference: payments[0].reference_number,
        invoice: payments[0].invoice_number,
        count: payments.length,
        total_duplicate_amount: payments[0].amount * (payments.length - 1),
        payment_ids: payments.map(p => p.id),
        created_dates: payments.map(p => p.created_date)
      }))
      .sort((a, b) => b.total_duplicate_amount - a.total_duplicate_amount);

    const totalDuplicateAmount = duplicateGroups.reduce((sum, group) => sum + group.total_duplicate_amount, 0);
    
    const actualRevenue = currentYearPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const deduplicatedRevenue = actualRevenue - totalDuplicateAmount;

    console.log(`✅ Found ${duplicateGroups.length} duplicate groups totaling $${totalDuplicateAmount}`);

    return Response.json({
      success: true,
      summary: {
        total_payments: currentYearPayments.length,
        duplicate_groups: duplicateGroups.length,
        total_duplicate_amount: totalDuplicateAmount,
        current_revenue_shown: actualRevenue,
        actual_revenue_after_dedup: deduplicatedRevenue,
        difference: actualRevenue - deduplicatedRevenue
      },
      duplicate_groups: duplicateGroups.slice(0, 30),
      recommendation: duplicateGroups.length > 0 
        ? `Delete ${duplicateGroups.reduce((sum, g) => sum + (g.count - 1), 0)} duplicate payments to fix revenue`
        : 'No duplicates found'
    });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});