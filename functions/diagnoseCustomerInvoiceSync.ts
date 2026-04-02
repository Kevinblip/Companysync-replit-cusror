import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('🔍 Starting customer-invoice sync diagnostic...');

    const [allCustomers, allInvoices] = await Promise.all([
      base44.asServiceRole.entities.Customer.list('-created_date', 10000),
      base44.asServiceRole.entities.Invoice.list('-created_date', 10000)
    ]);

    console.log(`Found ${allCustomers.length} customers and ${allInvoices.length} invoices`);

    // Build customer name lookup
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

    // Analyze invoices
    const invoicesWithoutCustomerId = [];
    const invoicesWithMismatchedName = [];
    const invoicesWithNoMatchingCustomer = [];
    const invoicesOk = [];

    for (const invoice of allInvoices) {
      const invoiceCustomerName = invoice.customer_name?.toLowerCase().trim();
      
      // Check if invoice has customer_id
      if (!invoice.customer_id) {
        // Try to find matching customer
        const matches = customersByName[invoiceCustomerName] || [];
        
        if (matches.length === 0) {
          invoicesWithNoMatchingCustomer.push({
            invoice_number: invoice.invoice_number,
            customer_name: invoice.customer_name,
            amount: invoice.amount
          });
        } else if (matches.length === 1) {
          invoicesWithoutCustomerId.push({
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            customer_name: invoice.customer_name,
            matched_customer_id: matches[0].id,
            matched_customer_name: matches[0].name
          });
        } else {
          invoicesWithoutCustomerId.push({
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            customer_name: invoice.customer_name,
            multiple_matches: matches.length,
            matched_customer_id: matches[0].id, // Use first match
            matched_customer_name: matches[0].name
          });
        }
      } else {
        // Invoice has customer_id - verify it matches the name
        const linkedCustomer = allCustomers.find(c => c.id === invoice.customer_id);
        
        if (!linkedCustomer) {
          invoicesWithMismatchedName.push({
            invoice_number: invoice.invoice_number,
            customer_id: invoice.customer_id,
            issue: 'Customer ID not found'
          });
        } else if (linkedCustomer.name?.toLowerCase().trim() !== invoiceCustomerName) {
          invoicesWithMismatchedName.push({
            invoice_number: invoice.invoice_number,
            invoice_name: invoice.customer_name,
            customer_name: linkedCustomer.name,
            issue: 'Name mismatch'
          });
        } else {
          invoicesOk.push(invoice.invoice_number);
        }
      }
    }

    // Calculate stats
    const totalIssues = invoicesWithoutCustomerId.length + invoicesWithMismatchedName.length + invoicesWithNoMatchingCustomer.length;
    const healthScore = allInvoices.length > 0 
      ? ((invoicesOk.length / allInvoices.length) * 100).toFixed(1)
      : 100;

    console.log(`✅ Diagnostic complete. Health score: ${healthScore}%`);

    return Response.json({
      success: true,
      summary: {
        total_customers: allCustomers.length,
        total_invoices: allInvoices.length,
        invoices_ok: invoicesOk.length,
        invoices_missing_customer_id: invoicesWithoutCustomerId.length,
        invoices_with_name_mismatch: invoicesWithMismatchedName.length,
        invoices_with_no_matching_customer: invoicesWithNoMatchingCustomer.length,
        total_issues: totalIssues,
        health_score: healthScore + '%'
      },
      details: {
        missing_customer_id: invoicesWithoutCustomerId.slice(0, 20),
        name_mismatches: invoicesWithMismatchedName.slice(0, 10),
        no_matching_customer: invoicesWithNoMatchingCustomer.slice(0, 10)
      },
      fixable: invoicesWithoutCustomerId.length,
      manual_review_needed: invoicesWithNoMatchingCustomer.length
    });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});