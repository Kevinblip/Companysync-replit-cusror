import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { items, source, company_id, merge = false } = await req.json();
    
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

    console.log(`🔄 Starting bulk import: ${items.length} items for source: ${source} merge=${merge}`);

    // ── Snapshot existing codes (for merge de-dupe) and favorites ──────────
    let favoriteCodes: Set<string> = new Set();
    let existingCodes: Set<string> = new Set();
    try {
      const existingItems = await base44.asServiceRole.entities.PriceListItem.filter({
        source,
        company_id: targetCompanyId,
      });
      existingItems.forEach((item: any) => {
        if (item.code) {
          existingCodes.add(item.code);
          if (item.is_favorite) favoriteCodes.add(item.code);
        }
      });
      console.log(`📋 Found ${existingCodes.size} existing codes (⭐ ${favoriteCodes.size} favorites)`);
    } catch (snapErr: any) {
      console.warn(`⚠️ Could not snapshot existing items: ${snapErr.message}`);
    }

    if (!merge) {
      // ── Create a 24h recovery backup before wiping ────────────────────────
      if (existingCodes.size > 0) {
        try {
          const existingItemsFull = await base44.asServiceRole.entities.PriceListItem.filter({
            source,
            company_id: targetCompanyId,
          });
          if (existingItemsFull.length > 0) {
            const backupId = `plbackup_${targetCompanyId.replace(/[^a-z0-9]/gi, '').slice(0, 24)}_${Date.now()}`;
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            // Replace any prior backup for this company+source
            try {
              const oldBackups = await base44.asServiceRole.entities.PriceListBackup.filter({
                company_id: targetCompanyId,
                source,
              });
              for (const ob of oldBackups) {
                await base44.asServiceRole.entities.PriceListBackup.delete(ob.id);
              }
            } catch { /* best-effort cleanup */ }
            await base44.asServiceRole.entities.PriceListBackup.create({
              id: backupId,
              company_id: targetCompanyId,
              source,
              item_count: existingItemsFull.length,
              items: existingItemsFull,
              created_at: new Date().toISOString(),
              expires_at: expiresAt,
            });
            console.log(`💾 Backup created: ${existingItemsFull.length} items (expires ${expiresAt})`);
          }
        } catch (backupErr: any) {
          console.warn(`⚠️ Could not create backup (non-fatal): ${backupErr.message}`);
        }
      }

      // Override mode: clear existing items first
      console.log(`🗑️ Override: clearing ${existingCodes.size} existing items for source: ${source}...`);
      try {
        const deletedCount = await base44.asServiceRole.entities.PriceListItem.deleteMany({
          source,
          company_id: targetCompanyId,
        });
        console.log(`✅ Deleted ${deletedCount} existing items`);
        existingCodes.clear();
      } catch (deleteError: any) {
        console.log(`⚠️ Could not bulk delete (may be first import): ${deleteError.message}`);
      }
    }

    // In merge mode, skip items whose code already exists
    const itemsToInsert = merge
      ? items.filter((item: any) => !item.code || !existingCodes.has(item.code))
      : items;
    console.log(`📦 ${merge ? 'Merge' : 'Override'}: inserting ${itemsToInsert.length} of ${items.length} items (${items.length - itemsToInsert.length} skipped as duplicates)`);

    // Import in batches with error handling
    // INCREASED batch size and added longer delays to handle large imports (7000+ items)
    const batchSize = 100; // Larger batches for efficiency
    let imported = 0;
    const failedBatches = [];
    const totalBatches = Math.ceil(itemsToInsert.length / batchSize);

    console.log(`📦 Processing ${itemsToInsert.length} items in ${totalBatches} batches of ${batchSize}...`);

    for (let i = 0; i < itemsToInsert.length; i += batchSize) {
      const batchNum = Math.floor(i / batchSize) + 1;
      const batch = itemsToInsert.slice(i, i + batchSize).map((item: any) => ({
        ...item,
        company_id: targetCompanyId,
        // Restore favorite flag if this code was a favorite before the wipe
        ...(favoriteCodes.has(item.code) ? { is_favorite: true } : {}),
      }));
      
      try {
        await base44.asServiceRole.entities.PriceListItem.bulkCreate(batch);
        imported += batch.length;
        console.log(`✅ Batch ${batchNum}/${totalBatches}: +${batch.length} items (Total: ${imported}/${itemsToInsert.length})`);
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
      if (i + batchSize < itemsToInsert.length) {
        const delay = itemsToInsert.length > 5000 ? 500 : 300; // Longer delay for very large imports
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