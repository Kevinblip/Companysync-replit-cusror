import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔗 Starting automatic invoice-customer sync...');

    const [allCustomers, allInvoices] = await Promise.all([
      base44.asServiceRole.entities.Customer.list('-created_date', 10000),
      base44.asServiceRole.entities.Invoice.list('-created_date', 10000)
    ]);

    console.log(`Found ${allCustomers.length} customers and ${allInvoices.length} invoices`);

    // Build customer name lookup (normalized)
    const customersByName = {};
    allCustomers.forEach(c => {
      const normalizedName = c.name?.toLowerCase().trim();
      if (normalizedName) {
        if (!customersByName[normalizedName]) {
          customersByName[normalizedName] = [];
        }
        customersByName[normalizedName].push(c);
      }
    });

    // Find and fix invoices without customer_id
    const invoicesToFix = allInvoices.filter(inv => !inv.customer_id);
    console.log(`Found ${invoicesToFix.length} invoices without customer_id`);

    let fixed = 0;
    let skipped = 0;
    const errors = [];
    const fixedList = [];

    for (const invoice of invoicesToFix) {
      const invoiceCustomerName = invoice.customer_name?.toLowerCase().trim();
      const matches = customersByName[invoiceCustomerName] || [];

      if (matches.length === 0) {
        skipped++;
        errors.push({
          invoice_number: invoice.invoice_number,
          customer_name: invoice.customer_name,
          issue: 'No matching customer found'
        });
        continue;
      }

      // Use first match (or best match if multiple)
      const customer = matches[0];

      try {
        await base44.asServiceRole.entities.Invoice.update(invoice.id, {
          customer_id: customer.id
        });
        
        fixed++;
        fixedList.push({
          invoice_number: invoice.invoice_number,
          customer_name: invoice.customer_name,
          linked_to: customer.name
        });

        if (fixed % 20 === 0) {
          console.log(`✅ Fixed ${fixed}/${invoicesToFix.length} invoices...`);
        }

        // Small delay to avoid rate limits
        if (fixed % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.error(`❌ Failed to update invoice ${invoice.invoice_number}:`, error.message);
        errors.push({
          invoice_number: invoice.invoice_number,
          customer_name: invoice.customer_name,
          error: error.message
        });
        skipped++;
      }
    }

    console.log(`✅ COMPLETE: Fixed ${fixed} invoices, skipped ${skipped}`);

    const newHealthScore = ((allInvoices.length - skipped) / allInvoices.length * 100).toFixed(1);

    return Response.json({
      success: true,
      message: `Successfully linked ${fixed} invoices to customers`,
      summary: {
        total_invoices: allInvoices.length,
        needed_fixing: invoicesToFix.length,
        fixed: fixed,
        skipped: skipped,
        errors: errors.length,
        new_health_score: newHealthScore + '%'
      },
      sample_fixed: fixedList.slice(0, 10),
      errors: errors.slice(0, 10)
    });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});