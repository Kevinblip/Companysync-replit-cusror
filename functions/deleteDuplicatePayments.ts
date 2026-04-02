import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🧹 Removing duplicate payments...');

    const allPayments = await base44.asServiceRole.entities.Payment.list('-payment_date', 10000);
    console.log(`Found ${allPayments.length} total payments`);

    const currentYear = new Date().getFullYear();
    const currentYearPayments = allPayments.filter(p => {
      if (!p.payment_date) return false;
      return new Date(p.payment_date).getFullYear() === currentYear;
    });

    // Group by: customer + amount + date + reference
    const paymentGroups = {};
    
    currentYearPayments.forEach(payment => {
      const key = `${payment.customer_name || 'unknown'}-${payment.amount || 0}-${payment.payment_date || 'nodate'}-${payment.reference_number || 'noref'}`;
      
      if (!paymentGroups[key]) {
        paymentGroups[key] = [];
      }
      paymentGroups[key].push(payment);
    });

    // Find duplicates and keep only the oldest one
    let deleted = 0;
    const deletedList = [];
    const errors = [];

    for (const [key, payments] of Object.entries(paymentGroups)) {
      if (payments.length <= 1) continue;

      // Sort by created_date, keep the oldest
      payments.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
      const toKeep = payments[0];
      const toDelete = payments.slice(1);

      console.log(`🔍 Duplicate group: ${payments[0].customer_name} - $${payments[0].amount} - Keeping oldest, deleting ${toDelete.length} duplicates`);

      for (const payment of toDelete) {
        try {
          await base44.asServiceRole.entities.Payment.delete(payment.id);
          deleted++;
          deletedList.push({
            customer: payment.customer_name,
            amount: payment.amount,
            date: payment.payment_date,
            payment_number: payment.payment_number
          });

          if (deleted % 10 === 0) {
            console.log(`✅ Deleted ${deleted} duplicate payments...`);
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (error) {
          console.error(`❌ Failed to delete payment ${payment.id}:`, error.message);
          errors.push({
            payment_number: payment.payment_number,
            customer: payment.customer_name,
            error: error.message
          });
        }
      }
    }

    const remainingRevenue = currentYearPayments
      .filter(p => !deletedList.some(d => d.payment_number === p.payment_number))
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    console.log(`✅ COMPLETE: Deleted ${deleted} duplicate payments`);

    return Response.json({
      success: true,
      message: `Successfully deleted ${deleted} duplicate payments`,
      deleted_count: deleted,
      estimated_corrected_revenue: remainingRevenue,
      sample_deleted: deletedList.slice(0, 10),
      errors: errors.length > 0 ? errors : []
    });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});