import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get company_id from request body
    let body = {};
    try {
      body = await req.json();
    } catch (e) {
      // empty body
    }
    
    let company_id = body.company_id;
    
    // If no company_id provided, try to determine from user
    if (!company_id) {
      const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
      if (staffProfiles.length > 0 && staffProfiles[0].company_id) {
        company_id = staffProfiles[0].company_id;
      } else {
        const companies = await base44.entities.Company.filter({ created_by: user.email });
        if (companies.length > 0) {
          company_id = companies[0].id;
        }
      }
    }
    
    if (!company_id) {
      return Response.json({ error: 'Could not determine company' }, { status: 400 });
    }
    
    console.log(`📦 Determined company_id: ${company_id}`);

    console.log(`🗑️ User ${user.email} deleting PriceListItem entities for company: ${company_id}`);

    // Fetch only items for this company
    const allItems = await base44.asServiceRole.entities.PriceListItem.filter({ company_id });
    
    if (allItems.length === 0) {
      console.log(`ℹ️ No items to delete.`);
      return Response.json({
        success: true,
        deletedCount: 0,
        message: 'No price list items found to delete.'
      });
    }

    // Delete in batches to avoid timeout
    const itemIds = allItems.map(item => item.id);
    const batchSize = 100;
    let deletedCount = 0;
    
    console.log(`🗑️ Deleting ${itemIds.length} items in batches of ${batchSize}...`);
    
    for (let i = 0; i < itemIds.length; i += batchSize) {
      const batch = itemIds.slice(i, i + batchSize);
      try {
        await base44.asServiceRole.entities.PriceListItem.bulkDelete(batch);
        deletedCount += batch.length;
        console.log(`Progress: ${deletedCount}/${itemIds.length}`);
      } catch (batchError) {
        console.log(`⚠️ Batch delete failed, trying individual for batch starting at ${i}`);
        for (const id of batch) {
          try {
            await base44.asServiceRole.entities.PriceListItem.delete(id);
            deletedCount++;
          } catch (e) {
            console.log(`⚠️ Could not delete ${id}: ${e.message}`);
          }
        }
      }
    }
    
    console.log(`✅ Deleted ${deletedCount} PriceListItem entities.`);

    return Response.json({
      success: true,
      deletedCount: deletedCount,
      message: `Successfully deleted ${deletedCount} price list items.`
    });

  } catch (error) {
    console.error('❌ Error deleting price list items:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});