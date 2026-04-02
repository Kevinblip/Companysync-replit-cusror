import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    console.log('🏥 Weekly Data Health Check Starting...');

    // Get all companies
    const companies = await base44.asServiceRole.entities.Company.list('-created_date', 10000);
    
    const issues = [];
    const fixes = [];

    // Check 1: Duplicate companies
    const companyOwners = {};
    companies.forEach(c => {
      if (!companyOwners[c.created_by]) companyOwners[c.created_by] = [];
      companyOwners[c.created_by].push(c);
    });

    Object.entries(companyOwners).forEach(([owner, companyList]) => {
      if (companyList.length > 1) {
        issues.push(`⚠️ User ${owner} has ${companyList.length} duplicate companies`);
      }
    });

    // Check 2: Duplicate payments (same customer, amount, date)
    const payments = await base44.asServiceRole.entities.Payment.list('-created_date', 10000);
    const paymentGroups = {};
    
    payments.forEach(p => {
      const key = `${p.customer_name}_${p.amount}_${p.payment_date}`;
      if (!paymentGroups[key]) paymentGroups[key] = [];
      paymentGroups[key].push(p);
    });

    let duplicatePaymentCount = 0;
    Object.values(paymentGroups).forEach(group => {
      if (group.length > 1) {
        duplicatePaymentCount += group.length - 1;
      }
    });

    if (duplicatePaymentCount > 0) {
      issues.push(`⚠️ ${duplicatePaymentCount} duplicate payment records detected`);
    }

    // Check 3: Orphaned records (no company_id)
    const customers = await base44.asServiceRole.entities.Customer.list('-created_date', 10000);
    const leads = await base44.asServiceRole.entities.Lead.list('-created_date', 10000);
    const invoices = await base44.asServiceRole.entities.Invoice.list('-created_date', 10000);

    const orphanedCustomers = customers.filter(c => !c.company_id).length;
    const orphanedLeads = leads.filter(l => !l.company_id).length;
    const orphanedInvoices = invoices.filter(i => !i.company_id).length;

    if (orphanedCustomers > 0) issues.push(`⚠️ ${orphanedCustomers} customers missing company_id`);
    if (orphanedLeads > 0) issues.push(`⚠️ ${orphanedLeads} leads missing company_id`);
    if (orphanedInvoices > 0) issues.push(`⚠️ ${orphanedInvoices} invoices missing company_id`);

    // Check 4: Unlinked estimates
    const estimates = await base44.asServiceRole.entities.Estimate.list('-created_date', 10000);
    const estimatesWithoutCustomer = estimates.filter(e => {
      const hasCustomer = customers.some(c => 
        c.name?.toLowerCase() === e.customer_name?.toLowerCase() ||
        c.email?.toLowerCase() === e.customer_email?.toLowerCase()
      );
      return !hasCustomer;
    }).length;

    if (estimatesWithoutCustomer > 0) {
      issues.push(`⚠️ ${estimatesWithoutCustomer} estimates not linked to customers`);
    }

    // Check 5: Invoice-Payment mismatches
    let invoicesWithPaymentMismatch = 0;
    invoices.forEach(inv => {
      const relatedPayments = payments.filter(p => 
        p.invoice_id === inv.id || p.invoice_number === inv.invoice_number
      );
      const totalPaid = relatedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
      
      if (Math.abs(totalPaid - (inv.amount_paid || 0)) > 1) {
        invoicesWithPaymentMismatch++;
      }
    });

    if (invoicesWithPaymentMismatch > 0) {
      issues.push(`⚠️ ${invoicesWithPaymentMismatch} invoices have payment amount mismatches`);
    }

    // Summary
    const summary = {
      check_date: new Date().toISOString(),
      total_issues: issues.length,
      issues: issues,
      fixes_applied: fixes,
      status: issues.length === 0 ? '✅ HEALTHY' : '⚠️ NEEDS ATTENTION',
      stats: {
        total_companies: companies.length,
        total_customers: customers.length,
        total_leads: leads.length,
        total_invoices: invoices.length,
        total_payments: payments.length,
        duplicate_payments: duplicatePaymentCount,
        orphaned_customers: orphanedCustomers,
        orphaned_leads: orphanedLeads,
        orphaned_invoices: orphanedInvoices
      }
    };

    console.log('🏥 Health Check Complete:', summary);

    // Send email notification if issues found
    if (issues.length > 0 && companies[0]) {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: companies[0].created_by,
        subject: `⚠️ Weekly Data Health Report - ${issues.length} Issues Found`,
        body: `Weekly Data Health Check Results\n\nDate: ${new Date().toLocaleDateString()}\n\nIssues Found:\n${issues.map(i => `• ${i}`).join('\n')}\n\nPlease review these issues in Dashboard → Settings → Utilities.\n\nThis is an automated weekly health check to keep your data clean.`
      });
    }

    return Response.json(summary);

  } catch (error) {
    console.error('❌ Health check error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});