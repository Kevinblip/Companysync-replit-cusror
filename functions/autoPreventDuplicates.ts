import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    console.log('🧹 Auto-cleanup: Removing duplicates...');

    const results = {
      duplicate_payments_deleted: 0,
      duplicate_customers_merged: 0,
      duplicate_leads_deleted: 0,
      orphaned_records_tagged: 0
    };

    // 1. Delete duplicate payments
    const payments = await base44.asServiceRole.entities.Payment.list('-created_date', 10000);
    const paymentGroups = {};
    
    payments.forEach(p => {
      const key = `${p.customer_name}_${p.amount}_${p.payment_date}_${p.reference_number || ''}`;
      if (!paymentGroups[key]) paymentGroups[key] = [];
      paymentGroups[key].push(p);
    });

    for (const group of Object.values(paymentGroups)) {
      if (group.length > 1) {
        // Keep oldest, delete rest
        group.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        for (let i = 1; i < group.length; i++) {
          await base44.asServiceRole.entities.Payment.delete(group[i].id);
          results.duplicate_payments_deleted++;
        }
      }
    }

    // 2. Delete duplicate leads (by ghl_contact_id)
    const leads = await base44.asServiceRole.entities.Lead.list('-created_date', 10000);
    const leadGroups = {};
    
    leads.forEach(l => {
      if (l.ghl_contact_id) {
        if (!leadGroups[l.ghl_contact_id]) leadGroups[l.ghl_contact_id] = [];
        leadGroups[l.ghl_contact_id].push(l);
      }
    });

    for (const group of Object.values(leadGroups)) {
      if (group.length > 1) {
        // Keep most complete/oldest, delete rest
        group.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        for (let i = 1; i < group.length; i++) {
          await base44.asServiceRole.entities.Lead.delete(group[i].id);
          results.duplicate_leads_deleted++;
        }
      }
    }

    // 3. Tag orphaned records with first available company
    const companies = await base44.asServiceRole.entities.Company.list('-created_date', 1);
    const defaultCompany = companies[0];

    if (defaultCompany) {
      const customers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);
      for (const customer of customers) {
        if (!customer.company_id) {
          await base44.asServiceRole.entities.Customer.update(customer.id, {
            company_id: defaultCompany.id
          });
          results.orphaned_records_tagged++;
        }
      }
    }

    console.log('✅ Auto-cleanup complete:', results);

    return Response.json({
      success: true,
      results,
      summary: `Cleaned ${results.duplicate_payments_deleted} duplicate payments, ${results.duplicate_leads_deleted} duplicate leads, tagged ${results.orphaned_records_tagged} orphaned records`
    });

  } catch (error) {
    console.error('❌ Auto-cleanup error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});