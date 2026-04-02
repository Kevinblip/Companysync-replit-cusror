import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { customerName, keepCustomerId, companyId } = await req.json();
    
    if (!customerName || !keepCustomerId || !companyId) {
      return Response.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    console.log(`🔄 Merging duplicates for: ${customerName}, keeping ID: ${keepCustomerId}`);
    
    // Get all customers with this name
    const allCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);
    const duplicates = allCustomers.filter(c => 
      c.name?.toLowerCase().trim() === customerName.toLowerCase().trim()
    );
    
    if (duplicates.length <= 1) {
      return Response.json({ error: 'No duplicates found' }, { status: 400 });
    }
    
    const keepCustomer = duplicates.find(c => c.id === keepCustomerId);
    if (!keepCustomer) {
      return Response.json({ error: 'Customer to keep not found' }, { status: 400 });
    }
    
    const deleteCustomers = duplicates.filter(c => c.id !== keepCustomerId);
    
    console.log(`📋 Found ${duplicates.length} duplicates, keeping 1, deleting ${deleteCustomers.length}`);
    
    // Update all related entities to point to the kept customer
    let entitiesUpdated = 0;
    
    // Update invoices
    const allInvoices = await base44.asServiceRole.entities.Invoice.list('-created_date', 10000);
    for (const invoice of allInvoices) {
      if (deleteCustomers.some(dc => dc.name === invoice.customer_name && dc.id !== keepCustomer.id)) {
        await base44.asServiceRole.entities.Invoice.update(invoice.id, {
          customer_id: keepCustomer.id,
          customer_name: keepCustomer.name,
          company_id: companyId
        });
        entitiesUpdated++;
      }
    }
    
    // Update payments
    const allPayments = await base44.asServiceRole.entities.Payment.list('-created_date', 10000);
    for (const payment of allPayments) {
      if (deleteCustomers.some(dc => dc.name === payment.customer_name && dc.id !== keepCustomer.id)) {
        await base44.asServiceRole.entities.Payment.update(payment.id, {
          customer_id: keepCustomer.id,
          customer_name: keepCustomer.name,
          company_id: companyId
        });
        entitiesUpdated++;
      }
    }
    
    // Update estimates
    const allEstimates = await base44.asServiceRole.entities.Estimate.list('-created_date', 10000);
    for (const estimate of allEstimates) {
      if (deleteCustomers.some(dc => dc.name === estimate.customer_name && dc.id !== keepCustomer.id)) {
        await base44.asServiceRole.entities.Estimate.update(estimate.id, {
          customer_id: keepCustomer.id,
          customer_name: keepCustomer.name,
          company_id: companyId
        });
        entitiesUpdated++;
      }
    }
    
    // Ensure the kept customer has the correct company_id
    await base44.asServiceRole.entities.Customer.update(keepCustomer.id, {
      company_id: companyId
    });
    
    // Delete duplicate customers
    for (const duplicate of deleteCustomers) {
      await base44.asServiceRole.entities.Customer.delete(duplicate.id);
    }
    
    return Response.json({
      success: true,
      message: `Merged ${duplicates.length} duplicates into 1 customer`,
      kept_customer_id: keepCustomer.id,
      deleted_count: deleteCustomers.length,
      entities_updated: entitiesUpdated
    });

  } catch (error) {
    console.error('Merge error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});