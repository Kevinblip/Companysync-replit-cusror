import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { company_id } = await req.json();

    if (!company_id) {
      return Response.json({ error: 'company_id required' }, { status: 400 });
    }

    // Check if accounts already exist
    const existing = await base44.asServiceRole.entities.ChartOfAccounts.filter({ 
      company_id 
    });

    if (existing.length > 0) {
      return Response.json({ 
        message: 'Accounts already exist', 
        count: existing.length 
      });
    }

    // Create standard chart of accounts
    const defaultAccounts = [
      // ASSETS
      { account_number: '1000', account_name: 'Cash', account_type: 'asset', account_subtype: 'current_assets', is_system_account: true },
      { account_number: '1200', account_name: 'Accounts Receivable', account_type: 'asset', account_subtype: 'current_assets', is_system_account: true },
      { account_number: '1500', account_name: 'Equipment', account_type: 'asset', account_subtype: 'fixed_assets', is_system_account: true },
      
      // LIABILITIES
      { account_number: '2000', account_name: 'Accounts Payable', account_type: 'liability', account_subtype: 'current_liabilities', is_system_account: true },
      { account_number: '2100', account_name: 'Credit Card', account_type: 'liability', account_subtype: 'current_liabilities', is_system_account: true },
      
      // EQUITY
      { account_number: '3000', account_name: 'Owner Equity', account_type: 'equity', account_subtype: 'owner_equity', is_system_account: true },
      { account_number: '3200', account_name: 'Retained Earnings', account_type: 'equity', account_subtype: 'owner_equity', is_system_account: true },
      
      // REVENUE
      { account_number: '4000', account_name: 'Sales Revenue', account_type: 'revenue', account_subtype: 'income', is_system_account: true },
      { account_number: '4100', account_name: 'Service Revenue', account_type: 'revenue', account_subtype: 'income', is_system_account: true },
      
      // COGS
      { account_number: '5000', account_name: 'Cost of Goods Sold', account_type: 'cogs', account_subtype: 'cost_of_sales', is_system_account: true },
      { account_number: '5100', account_name: 'Materials', account_type: 'cogs', account_subtype: 'cost_of_sales', is_system_account: true },
      { account_number: '5200', account_name: 'Subcontractors', account_type: 'cogs', account_subtype: 'cost_of_sales', is_system_account: true },
      
      // EXPENSES
      { account_number: '6000', account_name: 'Commission Expense', account_type: 'expense', account_subtype: 'operating_expenses', is_system_account: true },
      { account_number: '6100', account_name: 'Marketing Expense', account_type: 'expense', account_subtype: 'operating_expenses', is_system_account: true },
      { account_number: '6200', account_name: 'Office Supplies', account_type: 'expense', account_subtype: 'operating_expenses', is_system_account: true },
      { account_number: '6300', account_name: 'Rent', account_type: 'expense', account_subtype: 'operating_expenses', is_system_account: true },
      { account_number: '6400', account_name: 'Utilities', account_type: 'expense', account_subtype: 'operating_expenses', is_system_account: true },
      { account_number: '6500', account_name: 'Insurance', account_type: 'expense', account_subtype: 'operating_expenses', is_system_account: true },
      { account_number: '6600', account_name: 'Fuel', account_type: 'expense', account_subtype: 'operating_expenses', is_system_account: true },
      { account_number: '6700', account_name: 'Other Expenses', account_type: 'expense', account_subtype: 'operating_expenses', is_system_account: true },
    ];

    const created = [];
    for (const account of defaultAccounts) {
      const newAccount = await base44.asServiceRole.entities.ChartOfAccounts.create({
        company_id,
        ...account,
        balance: 0,
        is_active: true
      });
      created.push(newAccount);
    }

    return Response.json({ 
      success: true, 
      message: `Created ${created.length} default accounts`,
      accounts: created 
    });

  } catch (error) {
    console.error('Error setting up accounts:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});