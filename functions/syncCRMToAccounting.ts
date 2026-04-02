import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let company_id;
    try {
      const body = await req.json();
      console.log('📦 Received body:', JSON.stringify(body));
      console.log('📦 Body keys:', Object.keys(body));
      console.log('📦 company_id value:', body.company_id);
      company_id = body.company_id;
    } catch (error) {
      console.error('❌ Failed to parse body:', error.message);
      return Response.json({ error: 'Invalid request body', details: error.message }, { status: 400 });
    }

    console.log('🔍 Final company_id:', company_id);
    if (!company_id) {
      console.error('❌ No company_id found in request');
      return Response.json({ error: 'company_id required', receivedBody: 'check server logs' }, { status: 400 });
    }

    // Get chart of accounts
    const accounts = await base44.asServiceRole.entities.ChartOfAccounts.filter({ 
      company_id 
    });

    const cashAccount = accounts.find(a => a.account_number === '1000');
    const arAccount = accounts.find(a => a.account_number === '1200');
    const revenueAccount = accounts.find(a => a.account_number === '4000');
    const cogsAccount = accounts.find(a => a.account_number === '5000');
    const commissionExpenseAccount = accounts.find(a => a.account_number === '6000');

    if (!cashAccount || !revenueAccount || !arAccount) {
      return Response.json({ 
        error: 'Chart of Accounts not set up. Run setupDefaultAccounts first.' 
      }, { status: 400 });
    }

    // RESET ALL BALANCES TO ZERO before recalculating
    console.log('🔄 Resetting all account balances to zero...');
    for (const account of accounts) {
      await base44.asServiceRole.entities.ChartOfAccounts.update(account.id, {
        balance: 0
      });
    }

    const results = {
      invoices: 0,
      payments: 0,
      expenses: 0,
      payouts: 0,
      commissions: 0,
      errors: []
    };

    // 1. SYNC INVOICES → A/R and Revenue
    console.log('📊 Step 1: Fetching invoices...');
    let invoices = [];
    try {
      invoices = await base44.asServiceRole.entities.Invoice.filter({ 
        company_id
      });
      if (!invoices || !Array.isArray(invoices)) {
        invoices = [];
      }
      console.log(`✅ Found ${invoices.length} invoices`);
    } catch (error) {
      console.error('❌ Error fetching invoices:', error.message);
      results.errors.push(`Invoices fetch error: ${error.message}`);
      invoices = [];
    }

    console.log(`📝 Processing ${invoices.length} invoices...`);
    for (const invoice of invoices) {
      try {
        // Check if transaction already exists
        let existing = [];
        try {
          existing = await base44.asServiceRole.entities.Transaction.filter({
            company_id,
            related_entity_type: 'Invoice',
            related_entity_id: invoice.id
          }) || [];
        } catch (e) {
          existing = [];
        }

        if (!Array.isArray(existing)) existing = [];
        
        if (existing.length === 0) {
          // Create A/R transaction: Debit A/R, Credit Revenue
          await base44.asServiceRole.entities.Transaction.create({
            company_id,
            transaction_date: invoice.issue_date || invoice.created_date,
            transaction_type: 'invoice',
            reference_number: invoice.invoice_number,
            description: `Invoice ${invoice.invoice_number} - ${invoice.customer_name}`,
            debit_account_id: arAccount.id,
            debit_account_name: arAccount.account_name,
            debit_amount: invoice.amount,
            credit_account_id: revenueAccount.id,
            credit_account_name: revenueAccount.account_name,
            credit_amount: invoice.amount,
            related_entity_type: 'Invoice',
            related_entity_id: invoice.id
          });

          // Update A/R and Revenue balances
          await base44.asServiceRole.entities.ChartOfAccounts.update(arAccount.id, {
            balance: (arAccount.balance || 0) + invoice.amount
          });
          await base44.asServiceRole.entities.ChartOfAccounts.update(revenueAccount.id, {
            balance: (revenueAccount.balance || 0) + invoice.amount
          });

          results.invoices++;
        }
      } catch (error) {
        results.errors.push(`Invoice ${invoice.id}: ${error.message}`);
      }
    }

    // 2. SYNC PAYMENTS → Clear A/R
    console.log('📊 Step 2: Fetching payments...');
    let payments = [];
    try {
      payments = await base44.asServiceRole.entities.Payment.filter({ 
        company_id
      });
      if (!payments || !Array.isArray(payments)) {
        payments = [];
      } else {
        // Filter for received payments
        payments = payments.filter(p => p.status === 'received');
      }
      console.log(`✅ Found ${payments.length} received payments`);
    } catch (error) {
      console.error('❌ Error fetching payments:', error.message);
      results.errors.push(`Payments fetch error: ${error.message}`);
      payments = [];
    }

    console.log(`📝 Processing ${payments.length} payments...`);
    for (let i = 0; i < payments.length; i++) {
      const payment = payments[i];
      if (i % 10 === 0) {
        console.log(`  Progress: ${i}/${payments.length} payments processed`);
      }
      try {
        // Check if transaction already exists
        let existing = [];
        try {
          existing = await base44.asServiceRole.entities.Transaction.filter({
            company_id,
            related_entity_type: 'Payment',
            related_entity_id: payment.id
          }) || [];
        } catch (e) {
          existing = [];
        }

        if (!Array.isArray(existing)) existing = [];
        
        if (existing.length === 0) {
          // Create payment transaction: Debit Cash, Credit A/R
          await base44.asServiceRole.entities.Transaction.create({
            company_id,
            transaction_date: payment.payment_date || payment.created_date,
            transaction_type: 'payment',
            reference_number: payment.payment_number,
            description: `Payment from ${payment.customer_name}`,
            debit_account_id: cashAccount.id,
            debit_account_name: cashAccount.account_name,
            debit_amount: payment.amount,
            credit_account_id: arAccount.id,
            credit_account_name: arAccount.account_name,
            credit_amount: payment.amount,
            related_entity_type: 'Payment',
            related_entity_id: payment.id
          });

          // Update Cash and A/R balances
          await base44.asServiceRole.entities.ChartOfAccounts.update(cashAccount.id, {
            balance: (cashAccount.balance || 0) + payment.amount
          });
          await base44.asServiceRole.entities.ChartOfAccounts.update(arAccount.id, {
            balance: (arAccount.balance || 0) - payment.amount
          });

          results.payments++;
        }
      } catch (error) {
        results.errors.push(`Payment ${payment.id}: ${error.message}`);
      }
    }

    // 3. SYNC EXPENSES
    let expenses = [];
    try {
      expenses = await base44.asServiceRole.entities.Expense.filter({ 
        company_id 
      });
      if (!expenses || !Array.isArray(expenses)) {
        expenses = [];
      }
      console.log(`Found ${expenses.length} expenses`);
    } catch (error) {
      console.error('Error fetching expenses:', error.message);
      results.errors.push(`Expenses fetch error: ${error.message}`);
      expenses = [];
    }

    for (const expense of expenses) {
      try {
        let existing = [];
        try {
          existing = await base44.asServiceRole.entities.Transaction.filter({
            company_id,
            related_entity_type: 'Expense',
            related_entity_id: expense.id
          }) || [];
        } catch (e) {
          existing = [];
        }

        if (!Array.isArray(existing)) existing = [];
        
        if (existing.length === 0) {
          const expenseAccount = expense.category === 'cogs' 
            ? cogsAccount 
            : accounts.find(a => a.account_type === 'expense') || accounts.find(a => a.account_number === '6700');

          if (expenseAccount) {
            await base44.asServiceRole.entities.Transaction.create({
              company_id,
              transaction_date: expense.expense_date,
              transaction_type: 'expense',
              reference_number: expense.expense_number,
              description: `${expense.category}: ${expense.vendor_name}`,
              debit_account_id: expenseAccount.id,
              debit_account_name: expenseAccount.account_name,
              debit_amount: expense.amount,
              credit_account_id: cashAccount.id,
              credit_account_name: cashAccount.account_name,
              credit_amount: expense.amount,
              related_entity_type: 'Expense',
              related_entity_id: expense.id
            });

            // Update balances
            await base44.asServiceRole.entities.ChartOfAccounts.update(expenseAccount.id, {
              balance: (expenseAccount.balance || 0) + expense.amount
            });
            await base44.asServiceRole.entities.ChartOfAccounts.update(cashAccount.id, {
              balance: (cashAccount.balance || 0) - expense.amount
            });

            results.expenses++;
          }
        }
      } catch (error) {
        results.errors.push(`Expense ${expense.id}: ${error.message}`);
      }
    }

    // 4. SYNC PAYOUTS
    let payouts = [];
    try {
      payouts = await base44.asServiceRole.entities.Payout.filter({ 
        company_id
      });
      if (!payouts || !Array.isArray(payouts)) {
        payouts = [];
      } else {
        // Filter for completed payouts
        payouts = payouts.filter(p => p.status === 'completed');
      }
      console.log(`Found ${payouts.length} completed payouts`);
    } catch (error) {
      console.error('Error fetching payouts:', error.message);
      results.errors.push(`Payouts fetch error: ${error.message}`);
      payouts = [];
    }

    for (const payout of payouts) {
      try {
        let existing = [];
        try {
          existing = await base44.asServiceRole.entities.Transaction.filter({
            company_id,
            related_entity_type: 'Payout',
            related_entity_id: payout.id
          }) || [];
        } catch (e) {
          existing = [];
        }

        if (!Array.isArray(existing)) existing = [];
        
        if (existing.length === 0) {
          const payoutAccount = payout.payout_type === 'installer' ? cogsAccount : commissionExpenseAccount;

          if (payoutAccount) {
            await base44.asServiceRole.entities.Transaction.create({
              company_id,
              transaction_date: payout.payment_date || payout.created_date,
              transaction_type: 'payout',
              reference_number: payout.id,
              description: `Payout to ${payout.recipient_name}: ${payout.description}`,
              debit_account_id: payoutAccount.id,
              debit_account_name: payoutAccount.account_name,
              debit_amount: payout.amount,
              credit_account_id: cashAccount.id,
              credit_account_name: cashAccount.account_name,
              credit_amount: payout.amount,
              related_entity_type: 'Payout',
              related_entity_id: payout.id
            });

            // Update balances
            await base44.asServiceRole.entities.ChartOfAccounts.update(payoutAccount.id, {
              balance: (payoutAccount.balance || 0) + payout.amount
            });
            await base44.asServiceRole.entities.ChartOfAccounts.update(cashAccount.id, {
              balance: (cashAccount.balance || 0) - payout.amount
            });

            results.payouts++;
          }
        }
      } catch (error) {
        results.errors.push(`Payout ${payout.id}: ${error.message}`);
      }
    }

    // 5. SYNC COMMISSION PAYMENTS
    let commissions = [];
    try {
      commissions = await base44.asServiceRole.entities.CommissionPayment.filter({ 
        company_id
      });
      if (!commissions || !Array.isArray(commissions)) {
        commissions = [];
      } else {
        // Filter for paid commissions
        commissions = commissions.filter(c => c.status === 'paid');
      }
      console.log(`Found ${commissions.length} paid commissions`);
    } catch (error) {
      console.error('Error fetching commissions:', error.message);
      results.errors.push(`Commissions fetch error: ${error.message}`);
      commissions = [];
    }

    for (const commission of commissions) {
      try {
        let existing = [];
        try {
          existing = await base44.asServiceRole.entities.Transaction.filter({
            company_id,
            related_entity_type: 'CommissionPayment',
            related_entity_id: commission.id
          }) || [];
        } catch (e) {
          existing = [];
        }

        if (!Array.isArray(existing)) existing = [];
        
        if (existing.length === 0 && commissionExpenseAccount) {
          await base44.asServiceRole.entities.Transaction.create({
            company_id,
            transaction_date: commission.payment_date,
            transaction_type: 'expense',
            reference_number: commission.id,
            description: `Commission: ${commission.sales_rep_name} - ${commission.pay_period}`,
            debit_account_id: commissionExpenseAccount.id,
            debit_account_name: commissionExpenseAccount.account_name,
            debit_amount: commission.net_commission,
            credit_account_id: cashAccount.id,
            credit_account_name: cashAccount.account_name,
            credit_amount: commission.net_commission,
            related_entity_type: 'CommissionPayment',
            related_entity_id: commission.id
          });

          // Update balances
          await base44.asServiceRole.entities.ChartOfAccounts.update(commissionExpenseAccount.id, {
            balance: (commissionExpenseAccount.balance || 0) + commission.net_commission
          });
          await base44.asServiceRole.entities.ChartOfAccounts.update(cashAccount.id, {
            balance: (cashAccount.balance || 0) - commission.net_commission
          });

          results.commissions++;
        }
      } catch (error) {
        results.errors.push(`Commission ${commission.id}: ${error.message}`);
      }
    }

    return Response.json({ 
      success: true,
      message: 'CRM data synced to accounting',
      results
    });

  } catch (error) {
    console.error('Error syncing CRM to accounting:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});