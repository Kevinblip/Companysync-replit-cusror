import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔍 Diagnosing revenue doubling issue...');

    const [allPayments, allInvoices] = await Promise.all([
      base44.asServiceRole.entities.Payment.list('-payment_date', 10000),
      base44.asServiceRole.entities.Invoice.list('-created_date', 10000)
    ]);

    console.log(`Found ${allPayments.length} payments and ${allInvoices.length} invoices`);

    const currentYear = new Date().getFullYear();
    const currentYearPayments = allPayments.filter(p => {
      if (!p.payment_date) return false;
      return new Date(p.payment_date).getFullYear() === currentYear;
    });

    console.log(`${currentYearPayments.length} payments in ${currentYear}`);

    // Check for duplicate payments
    const paymentsByReference = {};
    const duplicates = [];
    
    currentYearPayments.forEach(payment => {
      const key = `${payment.customer_name}-${payment.amount}-${payment.payment_date}-${payment.reference_number || 'none'}`;
      if (!paymentsByReference[key]) {
        paymentsByReference[key] = [];
      }
      paymentsByReference[key].push(payment);
      
      if (paymentsByReference[key].length > 1) {
        duplicates.push({
          customer: payment.customer_name,
          amount: payment.amount,
          payment_date: payment.payment_date,
          reference: payment.reference_number,
          count: paymentsByReference[key].length,
          ids: paymentsByReference[key].map(p => p.id)
        });
      }
    });

    // Calculate revenue
    const totalRevenue = currentYearPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const uniqueRevenue = Object.values(paymentsByReference).reduce((sum, payments) => {
      // Only count the first payment in each duplicate group
      return sum + (payments[0].amount || 0);
    }, 0);

    // Check invoice amounts vs payments
    const paidInvoices2025 = allInvoices.filter(inv => {
      if (!inv.issue_date) return false;
      return new Date(inv.issue_date).getFullYear() === currentYear && inv.status === 'paid';
    });

    const invoiceBasedRevenue = paidInvoices2025.reduce((sum, inv) => sum + (inv.amount || 0), 0);

    // Sample payments
    const samplePayments = currentYearPayments.slice(0, 10).map(p => ({
      payment_number: p.payment_number,
      customer: p.customer_name,
      amount: p.amount,
      date: p.payment_date,
      reference: p.reference_number,
      invoice: p.invoice_number
    }));

    return Response.json({
      success: true,
      analysis: {
        total_payments_count: currentYearPayments.length,
        calculated_revenue: totalRevenue,
        unique_revenue_if_deduped: uniqueRevenue,
        duplicate_groups: duplicates.length,
        invoice_based_revenue: invoiceBasedRevenue,
        paid_invoices_count: paidInvoices2025.length
      },
      duplicates: duplicates.slice(0, 20),
      sample_payments: samplePayments,
      diagnosis: totalRevenue > uniqueRevenue * 1.5 
        ? 'Likely duplicate payments causing doubling' 
        : 'Revenue calculation appears normal, may be legitimate'
    });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});