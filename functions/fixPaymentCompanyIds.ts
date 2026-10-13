import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all companies
    const companies = await base44.entities.Company.list();
    
    if (companies.length === 0) {
      return Response.json({ error: 'No companies found' }, { status: 400 });
    }

    // For now, assume single company (most common case)
    // In multi-company apps, you'd need to determine company from customer or invoice
    const primaryCompany = companies[0];

    // Get all payments with null company_id
    const paymentsToFix = await base44.asServiceRole.entities.Payment.filter({ company_id: null });

    console.log(`Found ${paymentsToFix.length} payments with null company_id`);

    const results = {
      total: paymentsToFix.length,
      fixed: 0,
      errors: []
    };

    for (const payment of paymentsToFix) {
      try {
        // Determine company from customer or use primary company
        let companyId = primaryCompany.id;

        // Try to get company from customer if customer_id exists
        if (payment.customer_id) {
          const customers = await base44.asServiceRole.entities.Customer.filter({ 
            id: payment.customer_id 
          });
          if (customers[0]?.company_id) {
            companyId = customers[0].company_id;
          }
        }

        // Try to get company from invoice if invoice_id exists
        if (!companyId && payment.invoice_id) {
          const invoices = await base44.asServiceRole.entities.Invoice.filter({ 
            id: payment.invoice_id 
          });
          if (invoices[0]?.company_id) {
            companyId = invoices[0].company_id;
          }
        }

        // Update payment with company_id
        await base44.asServiceRole.entities.Payment.update(payment.id, {
          company_id: companyId
        });

        results.fixed++;
      } catch (error) {
        results.errors.push({
          payment_id: payment.id,
          payment_number: payment.payment_number,
          error: error.message
        });
      }
    }

    return Response.json({
      success: true,
      message: `Fixed ${results.fixed} of ${results.total} payments`,
      results
    });

  } catch (error) {
    console.error('Error fixing payment company_ids:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});