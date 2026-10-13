import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { companyId, dryRun = false } = await req.json();

    if (!companyId) {
      return Response.json({ error: 'companyId required' }, { status: 400 });
    }

    console.log('🔍 Diagnosing Accounts Receivable for company:', companyId);

    // Fetch all invoices and payments
    const allInvoices = await base44.asServiceRole.entities.Invoice.filter({ company_id: companyId });
    const allPayments = await base44.asServiceRole.entities.Payment.filter({ company_id: companyId });

    console.log(`📊 Total invoices: ${allInvoices.length}, Total payments: ${allPayments.length}`);

    let currentAR = 0;
    let correctAR = 0;
    let invoicesFixed = 0;
    const issues = [];

    for (const invoice of allInvoices) {
      const invoiceAmount = invoice.amount || 0;
      const amountPaid = invoice.amount_paid || 0;
      const status = invoice.status;
      const invoiceNumber = invoice.invoice_number;

      // Find actual payments for this invoice
      const relatedPayments = allPayments.filter(p => 
        p.invoice_number === invoiceNumber || 
        p.invoice_id === invoice.id
      );
      
      const actualPaid = relatedPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
      const balance = invoiceAmount - actualPaid;

      // Current AR calculation (what's wrong)
      if (status !== 'paid' && status !== 'cancelled') {
        currentAR += (invoiceAmount - amountPaid);
      }

      // Correct AR calculation (what it should be)
      if (actualPaid < invoiceAmount && status !== 'cancelled') {
        correctAR += balance;
      }

      // Check for issues
      if (Math.abs(amountPaid - actualPaid) > 0.01) {
        issues.push({
          invoice_number: invoiceNumber,
          customer: invoice.customer_name,
          status: status,
          invoice_amount: invoiceAmount,
          recorded_paid: amountPaid,
          actual_paid: actualPaid,
          balance: balance,
          issue: amountPaid > actualPaid ? 'Overpaid in system' : 'Underpaid in system'
        });

        // Fix the invoice if not dry run
        if (!dryRun) {
          let newStatus = status;
          if (actualPaid >= invoiceAmount) {
            newStatus = 'paid';
          } else if (actualPaid > 0) {
            newStatus = 'partially_paid';
          } else if (status === 'draft') {
            newStatus = 'draft';
          } else {
            newStatus = 'sent';
          }

          await base44.asServiceRole.entities.Invoice.update(invoice.id, {
            amount_paid: actualPaid,
            status: newStatus
          });
          invoicesFixed++;
        }
      }
    }

    console.log(`📊 Current AR (wrong): $${currentAR.toFixed(2)}`);
    console.log(`✅ Correct AR: $${correctAR.toFixed(2)}`);
    console.log(`📋 Issues found: ${issues.length}`);

    const summary = {
      total_invoices: allInvoices.length,
      issues_found: issues.length,
      current_ar: currentAR,
      correct_ar: correctAR,
      difference: currentAR - correctAR,
      invoices_fixed: invoicesFixed,
      issues: issues.slice(0, 20) // First 20 issues
    };

    if (dryRun) {
      return Response.json({
        success: true,
        dry_run: true,
        message: `Found ${issues.length} invoice discrepancies. Run with dryRun=false to fix.`,
        summary
      });
    }

    // Update the Accounts Receivable account in chart
    const arAccounts = await base44.asServiceRole.entities.ChartOfAccounts.filter({
      company_id: companyId,
      account_number: '1200'
    });

    if (arAccounts.length > 0) {
      await base44.asServiceRole.entities.ChartOfAccounts.update(arAccounts[0].id, {
        balance: correctAR
      });
      console.log('✅ Updated AR account balance to:', correctAR);
    }

    return Response.json({
      success: true,
      message: `Fixed ${invoicesFixed} invoices. AR corrected from $${currentAR.toFixed(2)} to $${correctAR.toFixed(2)}.`,
      summary
    });

  } catch (error) {
    console.error('❌ Fix AR error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});