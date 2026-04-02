import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { estimate1Id, estimate2Id, mergedEstimateData } = await req.json();

    if (!estimate1Id || !estimate2Id) {
      return Response.json({ error: 'Both estimate IDs are required' }, { status: 400 });
    }

    console.log('🔀 Merging estimates:', estimate1Id, estimate2Id);

    // Fetch both estimates
    const estimate1 = await base44.entities.Estimate.filter({ id: estimate1Id });
    const estimate2 = await base44.entities.Estimate.filter({ id: estimate2Id });

    if (!estimate1[0] || !estimate2[0]) {
      return Response.json({ error: 'One or both estimates not found' }, { status: 404 });
    }

    const est1 = estimate1[0];
    const est2 = estimate2[0];

    // Generate new estimate number
    const allEstimates = await base44.asServiceRole.entities.Estimate.list('-created_date', 10000);
    const numbers = allEstimates
      .map(e => e.estimate_number)
      .filter(num => num && num.startsWith('EST-'))
      .map(num => parseInt(num.replace(/EST-\d{4}-|[^\d]/g, '')))
      .filter(num => !isNaN(num));
    
    const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
    const newEstimateNumber = `EST-${new Date().getFullYear()}-${String(maxNumber + 1).padStart(4, '0')}`;

    // Combine line items from both estimates
    const combinedItems = [
      ...(est1.items || []).map(item => ({ ...item, source_estimate: est1.estimate_number })),
      ...(est2.items || []).map(item => ({ ...item, source_estimate: est2.estimate_number }))
    ];

    // Calculate combined totals
    const combinedAmount = (est1.amount || 0) + (est2.amount || 0);
    const combinedTax = (est1.total_tax || 0) + (est2.total_tax || 0);

    // Create merged estimate using data from mergedEstimateData (user selections)
    const mergedEstimate = await base44.asServiceRole.entities.Estimate.create({
      company_id: est1.company_id || est2.company_id,
      estimate_number: newEstimateNumber,
      customer_name: mergedEstimateData.customer_name,
      customer_email: mergedEstimateData.customer_email,
      customer_phone: mergedEstimateData.customer_phone,
      property_address: mergedEstimateData.property_address,
      insurance_company: mergedEstimateData.insurance_company,
      adjuster_name: mergedEstimateData.adjuster_name,
      adjuster_phone: mergedEstimateData.adjuster_phone,
      claim_number: mergedEstimateData.claim_number,
      amount: combinedAmount,
      total_tax: combinedTax,
      status: 'draft',
      items: combinedItems,
      notes: `MERGED ESTIMATE\n\nCombined from:\n- ${est1.estimate_number} ($${est1.amount})\n- ${est2.estimate_number} ($${est2.amount})\n\n${mergedEstimateData.notes || ''}`,
      valid_until: mergedEstimateData.valid_until,
      format_id: mergedEstimateData.format_id || est1.format_id,
      category: mergedEstimateData.category,
      tags: [...new Set([...(est1.tags || []), ...(est2.tags || [])])],
    });

    console.log('✅ Merged estimate created:', mergedEstimate.estimate_number);

    // Archive original estimates (keeps their status but hides from main list)
    await base44.asServiceRole.entities.Estimate.update(est1.id, {
      is_archived: true,
      notes: `${est1.notes || ''}\n\n[MERGED into ${newEstimateNumber}]`
    });

    await base44.asServiceRole.entities.Estimate.update(est2.id, {
      is_archived: true,
      notes: `${est2.notes || ''}\n\n[MERGED into ${newEstimateNumber}]`
    });

    console.log('✅ Original estimates marked as merged');

    return Response.json({
      success: true,
      merged_estimate: mergedEstimate,
      original_estimates: [est1.estimate_number, est2.estimate_number]
    });

  } catch (error) {
    console.error('❌ Error merging estimates:', error);
    return Response.json({
      error: error.message,
      success: false,
    }, { status: 500 });
  }
});