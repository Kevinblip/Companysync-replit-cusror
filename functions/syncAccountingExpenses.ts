import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

function mapCategory(name = '') {
  const n = String(name).toLowerCase();
  if (n.includes('cogs') || n.includes('cost of goods')) return 'cogs';
  if (n.includes('material')) return 'materials';
  if (n.includes('labor') || n.includes('wages') || n.includes('payroll')) return 'labor';
  if (n.includes('subcontract') || n.includes('sub contractor')) return 'subcontractor';
  if (n.includes('equipment') || n.includes('tools')) return 'equipment';
  if (n.includes('fuel') || n.includes('gas')) return 'fuel';
  if (n.includes('software')) return 'software';
  if (n.includes('rent')) return 'rent';
  if (n.includes('utilities') || n.includes('electric') || n.includes('water') || n.includes('internet')) return 'utilities';
  if (n.includes('insurance')) return 'insurance';
  if (n.includes('marketing') || n.includes('ads') || n.includes('advertising')) return 'marketing';
  if (n.includes('tax')) return 'taxes';
  if (n.includes('meals') || n.includes('restaurant')) return 'meals';
  if (n.includes('travel') || n.includes('hotel') || n.includes('airfare') || n.includes('flight')) return 'travel';
  return 'other';
}

function guessVendor(desc = '') {
  const d = String(desc).trim();
  if (!d) return 'Unknown Vendor';
  const cut = d.split(/\s+for\s+|\s+-\s+|\||:/i)[0];
  return cut.slice(0, 80);
}

function pickAmount(tx) {
  const d = Number(tx.debit_amount || 0);
  const c = Number(tx.credit_amount || 0);
  if (d > 0) return d;
  if (c > 0) return c; // rare but handle
  return 0;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { companyId } = body;

    // Find linked companies (owner + staff)
    const owned = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
    const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
    const staffCompanyIds = staffProfiles.map(s => s.company_id).filter(Boolean);
    const allCompanyIds = [...new Set([...(owned||[]).map(c => c.id), ...staffCompanyIds, companyId].filter(Boolean))];

    let imported = 0, skipped = 0;

    for (const cid of allCompanyIds) {
      // Load all expense-type transactions for this company
      const txns = await base44.asServiceRole.entities.Transaction.filter({ company_id: cid }, '-transaction_date', 10000);
      const expenseTxns = (txns || []).filter(t => String(t.transaction_type||'').toLowerCase() === 'expense');

      // Preload customers for linking by name-in-description
      const customers = await base44.asServiceRole.entities.Customer.filter({ company_id: cid }, '-created_date', 10000);

      for (const tx of expenseTxns) {
        const key = `txn:${tx.id}`; // unique marker we will store in notes
        // Check existing expense by reference_number or notes marker
        let existing = [];
        try {
          existing = await base44.asServiceRole.entities.Expense.filter({ company_id: cid }, '-created_date', 10000);
        } catch (_) { existing = []; }
        const found = existing.find(e => (e.reference_number && tx.reference_number && e.reference_number === tx.reference_number) || (e.notes || '').includes(key));
        if (found) { skipped++; continue; }

        const amount = pickAmount(tx);
        if (!amount || amount <= 0) { skipped++; continue; }

        // Try to link a customer from transaction fields
        let customer_id = undefined, customer_name = undefined;
        if (tx.related_entity_type && tx.related_entity_type.toLowerCase() === 'customer' && tx.related_entity_id) {
          const match = customers.find(c => c.id === tx.related_entity_id);
          if (match) { customer_id = match.id; customer_name = match.name; }
        }
        if (!customer_id && tx.description) {
          const lower = tx.description.toLowerCase();
          const guess = customers.find(c => lower.includes(String(c.name||'').toLowerCase()));
          if (guess) { customer_id = guess.id; customer_name = guess.name; }
        }

        const expenseData = {
          company_id: cid,
          expense_date: tx.transaction_date || new Date().toISOString().split('T')[0],
          vendor_name: guessVendor(tx.description || tx.debit_account_name || tx.credit_account_name),
          category: mapCategory(tx.debit_account_name || tx.credit_account_name || tx.description),
          amount: amount,
          description: tx.description || `${tx.debit_account_name || ''} -> ${tx.credit_account_name || ''}`.trim(),
          payment_method: 'bank_transfer',
          reference_number: tx.reference_number || '',
          customer_id,
          customer_name,
          notes: `synced_from_transaction | ${key}`,
          status: 'paid',
          tax_deductible: true,
        };

        await base44.asServiceRole.entities.Expense.create(expenseData);
        imported++;
      }
    }

    return Response.json({ success: true, imported, skipped });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});