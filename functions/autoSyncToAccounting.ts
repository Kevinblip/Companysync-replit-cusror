import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    // 🔐 Validate CRON_SECRET_TOKEN for automated calls
    const authToken = Deno.env.get('CRON_SECRET_TOKEN');
    let processedReq = req;
    
    if (authToken) {
        const requestToken = req.headers.get('Authorization')?.replace('Bearer ', '');
        if (requestToken === authToken) {
            const headers = new Headers(req.headers);
            headers.delete('Authorization');
            processedReq = new Request(req.url, { headers, body: req.body, method: req.method });
        }
    }
    
    const base44 = createClientFromRequest(processedReq);
    
    const { entity_type, entity_id, company_id, action } = await req.json();

    if (!entity_type || !entity_id || !company_id) {
      return Response.json({ 
        error: 'entity_type, entity_id, and company_id required' 
      }, { status: 400 });
    }

    // Get chart of accounts
    const accounts = await base44.asServiceRole.entities.ChartOfAccounts.filter({ 
      company_id 
    });

    if (accounts.length === 0) {
      return Response.json({ 
        message: 'Chart of Accounts not set up yet - skipping accounting sync' 
      });
    }

    const cashAccount = accounts.find(a => a.account_number === '1000');
    const accountsReceivableAccount = accounts.find(a => a.account_number === '1200');
    const revenueAccount = accounts.find(a => a.account_number === '4000');
    const cogsAccount = accounts.find(a => a.account_number === '5000');
    const commissionExpenseAccount = accounts.find(a => a.account_number === '6000');

    let transaction = null;

    // INVOICE CREATED - Create A/R entry
    if (entity_type === 'Invoice' && action === 'created') {
      const invoice = await base44.asServiceRole.entities.Invoice.filter({ id: entity_id });
      if (invoice[0] && invoice[0].status !== 'draft' && accountsReceivableAccount && revenueAccount) {
        transaction = await base44.asServiceRole.entities.Transaction.create({
          company_id,
          transaction_date: invoice[0].issue_date || invoice[0].created_date,
          transaction_type: 'invoice',
          reference_number: invoice[0].invoice_number,
          description: `Invoice for ${invoice[0].customer_name}`,
          debit_account_id: accountsReceivableAccount.id,
          debit_account_name: accountsReceivableAccount.account_name,
          debit_amount: invoice[0].amount,
          credit_account_id: revenueAccount.id,
          credit_account_name: revenueAccount.account_name,
          credit_amount: invoice[0].amount,
          related_entity_type: 'Invoice',
          related_entity_id: invoice[0].id
        });

        // Update balances
        await base44.asServiceRole.entities.ChartOfAccounts.update(accountsReceivableAccount.id, {
          balance: (accountsReceivableAccount.balance || 0) + invoice[0].amount
        });
        await base44.asServiceRole.entities.ChartOfAccounts.update(revenueAccount.id, {
          balance: (revenueAccount.balance || 0) + invoice[0].amount
        });
      }
    }

    // PAYMENT RECEIVED - Reduce A/R, Increase Cash
    if (entity_type === 'Payment' && action === 'created') {
      const payment = await base44.asServiceRole.entities.Payment.filter({ id: entity_id });
      if (payment[0] && payment[0].status === 'received' && cashAccount && accountsReceivableAccount) {
        transaction = await base44.asServiceRole.entities.Transaction.create({
          company_id,
          transaction_date: payment[0].payment_date || payment[0].created_date,
          transaction_type: 'payment',
          reference_number: payment[0].payment_number,
          description: `Payment from ${payment[0].customer_name}`,
          debit_account_id: cashAccount.id,
          debit_account_name: cashAccount.account_name,
          debit_amount: payment[0].amount,
          credit_account_id: accountsReceivableAccount.id,
          credit_account_name: accountsReceivableAccount.account_name,
          credit_amount: payment[0].amount,
          related_entity_type: 'Payment',
          related_entity_id: payment[0].id
        });

        // Update balances
        await base44.asServiceRole.entities.ChartOfAccounts.update(cashAccount.id, {
          balance: (cashAccount.balance || 0) + payment[0].amount
        });
        await base44.asServiceRole.entities.ChartOfAccounts.update(accountsReceivableAccount.id, {
          balance: (accountsReceivableAccount.balance || 0) - payment[0].amount
        });
      }
    }

    // EXPENSE CREATED
    if (entity_type === 'Expense' && action === 'created') {
      const expense = await base44.asServiceRole.entities.Expense.filter({ id: entity_id });
      if (expense[0] && cashAccount) {
        const expenseAccount = expense[0].category === 'cogs' 
          ? cogsAccount 
          : accounts.find(a => a.account_type === 'expense') || accounts.find(a => a.account_number === '6700');

        if (expenseAccount) {
          transaction = await base44.asServiceRole.entities.Transaction.create({
            company_id,
            transaction_date: expense[0].expense_date,
            transaction_type: 'expense',
            reference_number: expense[0].expense_number,
            description: `${expense[0].category}: ${expense[0].vendor_name}`,
            debit_account_id: expenseAccount.id,
            debit_account_name: expenseAccount.account_name,
            debit_amount: expense[0].amount,
            credit_account_id: cashAccount.id,
            credit_account_name: cashAccount.account_name,
            credit_amount: expense[0].amount,
            related_entity_type: 'Expense',
            related_entity_id: expense[0].id
          });

          // Update balances
          await base44.asServiceRole.entities.ChartOfAccounts.update(expenseAccount.id, {
            balance: (expenseAccount.balance || 0) + expense[0].amount
          });
          await base44.asServiceRole.entities.ChartOfAccounts.update(cashAccount.id, {
            balance: (cashAccount.balance || 0) - expense[0].amount
          });
        }
      }
    }

    // PAYOUT COMPLETED
    if (entity_type === 'Payout' && (action === 'completed' || action === 'created')) {
      const payout = await base44.asServiceRole.entities.Payout.filter({ id: entity_id });
      if (payout[0] && payout[0].status === 'completed' && cashAccount) {
        const payoutAccount = payout[0].payout_type === 'installer' ? cogsAccount : commissionExpenseAccount;

        if (payoutAccount) {
          transaction = await base44.asServiceRole.entities.Transaction.create({
            company_id,
            transaction_date: payout[0].payment_date || payout[0].created_date,
            transaction_type: 'payout',
            reference_number: payout[0].id,
            description: `Payout to ${payout[0].recipient_name}: ${payout[0].description}`,
            debit_account_id: payoutAccount.id,
            debit_account_name: payoutAccount.account_name,
            debit_amount: payout[0].amount,
            credit_account_id: cashAccount.id,
            credit_account_name: cashAccount.account_name,
            credit_amount: payout[0].amount,
            related_entity_type: 'Payout',
            related_entity_id: payout[0].id
          });

          // Update balances
          await base44.asServiceRole.entities.ChartOfAccounts.update(payoutAccount.id, {
            balance: (payoutAccount.balance || 0) + payout[0].amount
          });
          await base44.asServiceRole.entities.ChartOfAccounts.update(cashAccount.id, {
            balance: (cashAccount.balance || 0) - payout[0].amount
          });
        }
      }
    }

    // COMMISSION PAYMENT
    if (entity_type === 'CommissionPayment' && action === 'created') {
      const commission = await base44.asServiceRole.entities.CommissionPayment.filter({ id: entity_id });
      if (commission[0] && commission[0].status === 'paid' && cashAccount && commissionExpenseAccount) {
        transaction = await base44.asServiceRole.entities.Transaction.create({
          company_id,
          transaction_date: commission[0].payment_date,
          transaction_type: 'expense',
          reference_number: commission[0].id,
          description: `Commission: ${commission[0].sales_rep_name} - ${commission[0].pay_period}`,
          debit_account_id: commissionExpenseAccount.id,
          debit_account_name: commissionExpenseAccount.account_name,
          debit_amount: commission[0].net_commission,
          credit_account_id: cashAccount.id,
          credit_account_name: cashAccount.account_name,
          credit_amount: commission[0].net_commission,
          related_entity_type: 'CommissionPayment',
          related_entity_id: commission[0].id
        });

        // Update balances
        await base44.asServiceRole.entities.ChartOfAccounts.update(commissionExpenseAccount.id, {
          balance: (commissionExpenseAccount.balance || 0) + commission[0].net_commission
        });
        await base44.asServiceRole.entities.ChartOfAccounts.update(cashAccount.id, {
          balance: (cashAccount.balance || 0) - commission[0].net_commission
        });
      }
    }

    return Response.json({ 
      success: true,
      transaction_created: !!transaction,
      transaction
    });

  } catch (error) {
    console.error('Error auto-syncing to accounting:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});