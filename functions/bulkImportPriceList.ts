import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { items, source, company_id } = await req.json();
    
    // Get company_id - either passed in or determine from user
    let targetCompanyId = company_id;
    if (!targetCompanyId) {
      // Try to find company from staff profile
      const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
      if (staffProfiles.length > 0 && staffProfiles[0].company_id) {
        targetCompanyId = staffProfiles[0].company_id;
      } else {
        // Try to find company created by user
        const companies = await base44.entities.Company.filter({ created_by: user.email });
        if (companies.length > 0) {
          targetCompanyId = companies[0].id;
        }
      }
    }
    
    if (!targetCompanyId) {
      return Response.json({ 
        success: false, 
        error: 'Could not determine company for import' 
      }, { status: 400 });
    }
    
    console.log(`📦 Company ID for import: ${targetCompanyId}`);

    if (!items || !Array.isArray(items) || items.length === 0) {
      return Response.json({ 
        success: false, 
        error: 'No items provided' 
      }, { status: 400 });
    }

    console.log(`🔄 Starting bulk import: ${items.length} items for source: ${source}`);

    // Clear existing items for this source AND company using bulk delete
    console.log(`🗑️ Clearing existing items for source: ${source} and company: ${targetCompanyId}...`);
    try {
      // Delete all existing items for this source AND company at once
      const existingCount = await base44.asServiceRole.entities.PriceListItem.deleteMany({ 
        source: source,
        company_id: targetCompanyId 
      });
      console.log(`✅ Deleted ${existingCount} existing items`);
    } catch (deleteError) {
      console.log(`⚠️ Could not bulk delete (may be first import): ${deleteError.message}`);
    }

    // Import in batches with error handling
    // INCREASED batch size and added longer delays to handle large imports (7000+ items)
    const batchSize = 100; // Larger batches for efficiency
    let imported = 0;
    const failedBatches = [];
    const totalBatches = Math.ceil(items.length / batchSize);

    console.log(`📦 Processing ${items.length} items in ${totalBatches} batches of ${batchSize}...`);

    for (let i = 0; i < items.length; i += batchSize) {
      const batchNum = Math.floor(i / batchSize) + 1;
      const batch = items.slice(i, i + batchSize).map(item => ({
        ...item,
        company_id: targetCompanyId // Ensure company_id is set on every item
      }));
      
      try {
        await base44.asServiceRole.entities.PriceListItem.bulkCreate(batch);
        imported += batch.length;
        console.log(`✅ Batch ${batchNum}/${totalBatches}: +${batch.length} items (Total: ${imported}/${items.length})`);
      } catch (batchError) {
        console.error(`❌ Batch ${batchNum}/${totalBatches} failed:`, batchError.message);
        failedBatches.push({ batchNumber: batchNum, error: batchError.message, itemCount: batch.length });
        
        // Retry with smaller sub-batches on failure
        console.log(`🔄 Retrying batch ${batchNum} in smaller chunks...`);
        const subBatchSize = 25;
        for (let j = 0; j < batch.length; j += subBatchSize) {
          const subBatch = batch.slice(j, j + subBatchSize);
          try {
            await base44.asServiceRole.entities.PriceListItem.bulkCreate(subBatch);
            imported += subBatch.length;
            console.log(`  ✅ Sub-batch: +${subBatch.length} items`);
          } catch (subError) {
            console.error(`  ❌ Sub-batch failed: ${subError.message}`);
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      // Longer delay between batches to avoid rate limiting (especially for large imports)
      if (i + batchSize < items.length) {
        const delay = items.length > 5000 ? 500 : 300; // Longer delay for very large imports
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    if (failedBatches.length > 0) {
      console.warn(`⚠️ ${failedBatches.length} batches failed to import`);
    }

    console.log('✅ Bulk import complete!');

    return Response.json({
      success: true,
      imported: imported,
      total: items.length,
      failedBatches: failedBatches.length > 0 ? failedBatches : undefined
    });

  } catch (error) {
    console.error('❌ Bulk import error:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});