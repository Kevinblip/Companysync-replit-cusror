import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all companies and use the first one (most common case)
    const companies = await base44.entities.Company.list();
    
    if (companies.length === 0) {
      return Response.json({ error: 'No companies found' }, { status: 400 });
    }

    const company_id = companies[0].id;

    // Get chart of accounts
    const accounts = await base44.asServiceRole.entities.ChartOfAccounts.filter({ 
      company_id 
    });

    const accountsReceivableAccount = accounts.find(a => a.account_number === '1200');
    const revenueAccount = accounts.find(a => a.account_number === '4000');

    if (!accountsReceivableAccount || !revenueAccount) {
      return Response.json({ 
        error: 'Chart of Accounts not set up properly - missing A/R (1200) or Revenue (4000)' 
      }, { status: 400 });
    }

    // Get all unpaid invoices (sent, viewed, partially_paid, overdue)
    const invoices = await base44.asServiceRole.entities.Invoice.filter({ 
      company_id 
    });

    const unpaidInvoices = invoices.filter(inv => 
      inv.status !== 'draft' && 
      inv.status !== 'paid' && 
      inv.status !== 'cancelled'
    );

    console.log(`Found ${unpaidInvoices.length} unpaid invoices to sync`);

    const results = {
      total: unpaidInvoices.length,
      synced: 0,
      skipped: 0,
      errors: []
    };

    let totalARAmount = 0;

    for (const invoice of unpaidInvoices) {
      try {
        // Check if transaction already exists for this invoice
        const existingTransactions = await base44.asServiceRole.entities.Transaction.filter({
          company_id,
          related_entity_type: 'Invoice',
          related_entity_id: invoice.id
        });

        if (existingTransactions.length > 0) {
          results.skipped++;
          continue;
        }

        const amountDue = invoice.amount - (invoice.amount_paid || 0);

        if (amountDue <= 0) {
          results.skipped++;
          continue;
        }

        // Create A/R transaction
        await base44.asServiceRole.entities.Transaction.create({
          company_id,
          transaction_date: invoice.issue_date || invoice.created_date,
          transaction_type: 'invoice',
          reference_number: invoice.invoice_number,
          description: `Invoice for ${invoice.customer_name} (Backfilled)`,
          debit_account_id: accountsReceivableAccount.id,
          debit_account_name: accountsReceivableAccount.account_name,
          debit_amount: amountDue,
          credit_account_id: revenueAccount.id,
          credit_account_name: revenueAccount.account_name,
          credit_amount: amountDue,
          related_entity_type: 'Invoice',
          related_entity_id: invoice.id
        });

        totalARAmount += amountDue;
        results.synced++;

      } catch (error) {
        results.errors.push({
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          error: error.message
        });
      }
    }

    // Update account balances
    await base44.asServiceRole.entities.ChartOfAccounts.update(accountsReceivableAccount.id, {
      balance: (accountsReceivableAccount.balance || 0) + totalARAmount
    });
    await base44.asServiceRole.entities.ChartOfAccounts.update(revenueAccount.id, {
      balance: (revenueAccount.balance || 0) + totalARAmount
    });

    return Response.json({
      success: true,
      message: `Synced ${results.synced} invoices, skipped ${results.skipped}, ${results.errors.length} errors`,
      total_ar_added: totalARAmount,
      results
    });

  } catch (error) {
    console.error('Error backfilling invoice A/R:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});