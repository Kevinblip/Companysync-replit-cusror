import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  console.log('🚀 Starting fixOrphanedRecords...');
  
  try {
    console.log('🔐 Creating Base44 client...');
    const base44 = createClientFromRequest(req);
    
    console.log('👤 Authenticating user...');
    const user = await base44.auth.me();

    if (!user) {
      console.error('❌ User not authenticated');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    console.log(`✅ User authenticated: ${user.email}`);

    // Get the valid company (only 1 should exist now)
    console.log('🏢 Fetching companies...');
    const validCompanies = await base44.asServiceRole.entities.Company.list('-created_date', 100);
    console.log(`📊 Found ${validCompanies.length} companies`);
    
    if (validCompanies.length === 0) {
      console.error('❌ No valid company found');
      return Response.json({ error: 'No valid company found' }, { status: 400 });
    }

    const targetCompanyId = validCompanies[0].id;
    console.log(`✅ Target company: ${validCompanies[0].company_name} (${targetCompanyId})`);

    let stats = {
      customers_fixed: 0,
      estimates_fixed: 0,
      invoices_fixed: 0,
      payments_fixed: 0,
      leads_fixed: 0
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Fix all customers with wrong/missing company_id
    console.log('🔍 Fetching all customers...');
    const allCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);
    console.log(`📊 Found ${allCustomers.length} customers`);
    
    for (let i = 0; i < allCustomers.length; i++) {
      const customer = allCustomers[i];
      if (customer.company_id !== targetCompanyId) {
        await base44.asServiceRole.entities.Customer.update(customer.id, {
          company_id: targetCompanyId
        });
        stats.customers_fixed++;
        console.log(`✅ Fixed customer ${i + 1}/${allCustomers.length}: ${customer.name}`);
        
        if (i % 5 === 0 && i > 0) {
          await sleep(300);
        }
      }
    }

    // Fix all estimates with wrong/missing company_id
    console.log('🔍 Fetching all estimates...');
    const allEstimates = await base44.asServiceRole.entities.Estimate.list('-created_date', 10000);
    console.log(`📊 Found ${allEstimates.length} estimates`);
    
    for (let i = 0; i < allEstimates.length; i++) {
      const estimate = allEstimates[i];
      if (estimate.company_id !== targetCompanyId) {
        await base44.asServiceRole.entities.Estimate.update(estimate.id, {
          company_id: targetCompanyId
        });
        stats.estimates_fixed++;
        console.log(`✅ Fixed estimate ${i + 1}/${allEstimates.length}: ${estimate.estimate_number}`);
        
        if (i % 5 === 0 && i > 0) {
          await sleep(300);
        }
      }
    }

    // Fix all invoices with wrong/missing company_id
    console.log('🔍 Fetching all invoices...');
    const allInvoices = await base44.asServiceRole.entities.Invoice.list('-created_date', 10000);
    console.log(`📊 Found ${allInvoices.length} invoices`);
    
    for (let i = 0; i < allInvoices.length; i++) {
      const invoice = allInvoices[i];
      if (invoice.company_id !== targetCompanyId) {
        await base44.asServiceRole.entities.Invoice.update(invoice.id, {
          company_id: targetCompanyId
        });
        stats.invoices_fixed++;
        console.log(`✅ Fixed invoice ${i + 1}/${allInvoices.length}: ${invoice.invoice_number}`);
        
        if (i % 5 === 0 && i > 0) {
          await sleep(300);
        }
      }
    }

    // Fix all payments with wrong/missing company_id
    console.log('🔍 Fetching all payments...');
    const allPayments = await base44.asServiceRole.entities.Payment.list('-created_date', 10000);
    console.log(`📊 Found ${allPayments.length} payments`);
    
    for (let i = 0; i < allPayments.length; i++) {
      const payment = allPayments[i];
      if (payment.company_id !== targetCompanyId) {
        await base44.asServiceRole.entities.Payment.update(payment.id, {
          company_id: targetCompanyId
        });
        stats.payments_fixed++;
        console.log(`✅ Fixed payment ${i + 1}/${allPayments.length}: ${payment.id}`);
        
        if (i % 5 === 0 && i > 0) {
          await sleep(300);
        }
      }
    }

    // Fix all leads with wrong/missing company_id
    console.log('🔍 Fetching all leads...');
    const allLeads = await base44.asServiceRole.entities.Lead.list('-created_date', 10000);
    console.log(`📊 Found ${allLeads.length} leads`);
    
    for (let i = 0; i < allLeads.length; i++) {
      const lead = allLeads[i];
      if (lead.company_id !== targetCompanyId) {
        await base44.asServiceRole.entities.Lead.update(lead.id, {
          company_id: targetCompanyId
        });
        stats.leads_fixed++;
        console.log(`✅ Fixed lead ${i + 1}/${allLeads.length}: ${lead.name}`);
        
        if (i % 5 === 0 && i > 0) {
          await sleep(300);
        }
      }
    }

    console.log('✅ All records fixed!');
    console.log('📊 Final stats:', stats);
    
    return Response.json({
      success: true,
      stats: stats,
      targetCompanyId: targetCompanyId,
      targetCompanyName: validCompanies[0].company_name
    });

  } catch (error) {
    console.error('❌❌❌ FIX ORPHANED RECORDS ERROR ❌❌❌');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error toString:', error.toString());
    
    return Response.json({
      success: false,
      error: error.message || 'Failed to fix orphaned records',
      details: error.toString(),
      stack: error.stack
    }, { status: 500 });
  }
});