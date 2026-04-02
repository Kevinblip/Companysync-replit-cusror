import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { companyId, forceUpdate } = await req.json();
    if (!companyId) {
      return Response.json({ error: 'Company ID required' }, { status: 400 });
    }

    console.log('🔄 Backfilling commissions for company:', companyId);

    const [allInvoices, staffProfiles] = await Promise.all([
      base44.asServiceRole.entities.Invoice.list('-created_date', 10000),
      base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId })
    ]);

    // Filter invoices for this company
    const invoices = allInvoices.filter(inv => inv.company_id === companyId);
    console.log(`📊 Found ${invoices.length} invoices for this company`);

    let updated = 0;
    let skipped = 0;

    for (const invoice of invoices) {
      try {
        // Skip if has commission_splits AND not forcing
        if (!forceUpdate && invoice.commission_splits?.length > 0) {
          skipped++;
          continue;
        }

        // Use invoice's sale_agent or created_by
        const assignedEmail = invoice.sale_agent || invoice.created_by || user.email;
        const staffProfile = staffProfiles.find(sp => sp.user_email === assignedEmail);
        
        const commissionSplits = [{
          user_email: assignedEmail,
          user_name: staffProfile?.full_name || assignedEmail,
          split_percentage: 100,
          role: 'Sales Rep'
        }];

        await base44.asServiceRole.entities.Invoice.update(invoice.id, {
          commission_splits: commissionSplits,
          sale_agent: assignedEmail,
          sale_agent_name: staffProfile?.full_name || assignedEmail
        });
        
        updated++;
        if (updated % 10 === 0) console.log(`✅ Updated ${updated}...`);
        
      } catch (error) {
        console.error(`Failed to update ${invoice.invoice_number}:`, error);
      }
    }

    console.log(`✅ Done: ${updated} updated, ${skipped} skipped`);

    return Response.json({
      success: true,
      updated,
      skipped,
      totalInvoices: invoices.length
    });

  } catch (error) {
    console.error('Backfill error:', error);
    return Response.json({ error: error.message, success: false }, { status: 500 });
  }
});