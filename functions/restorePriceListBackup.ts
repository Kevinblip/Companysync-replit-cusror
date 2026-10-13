import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { company_id, source } = await req.json();

    if (!company_id) {
      return Response.json({ success: false, error: 'company_id is required' }, { status: 400 });
    }
    if (!source) {
      return Response.json({ success: false, error: 'source is required' }, { status: 400 });
    }

    // Verify the caller belongs to this company
    const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
    const isStaff = staffProfiles.some((s: any) => s.company_id === company_id);
    if (!isStaff) {
      const companies = await base44.entities.Company.filter({ created_by: user.email });
      const owns = companies.some((c: any) => c.id === company_id);
      if (!owns) {
        return Response.json({ success: false, error: 'Access denied for this company' }, { status: 403 });
      }
    }

    // Find the backup
    const backups = await base44.asServiceRole.entities.PriceListBackup.filter({
      company_id,
      source,
    });

    if (!backups || backups.length === 0) {
      return Response.json({ success: false, error: 'No backup found for this source' }, { status: 404 });
    }

    // Pick the most recently created backup
    const backup = backups.sort((a: any, b: any) =>
      new Date(b.created_at || b.created_date || 0).getTime() -
      new Date(a.created_at || a.created_date || 0).getTime()
    )[0];

    // Check expiry
    if (backup.expires_at && new Date(backup.expires_at) < new Date()) {
      // Clean up expired backup
      try { await base44.asServiceRole.entities.PriceListBackup.delete(backup.id); } catch { /* best-effort */ }
      return Response.json({ success: false, error: 'Backup has expired (older than 24 hours)' }, { status: 410 });
    }

    const items: any[] = backup.items || [];
    if (items.length === 0) {
      return Response.json({ success: false, error: 'Backup contains no items' }, { status: 400 });
    }

    console.log(`🔄 Restoring ${items.length} items for source=${source}, company=${company_id}`);

    // Wipe the current items for this source
    try {
      await base44.asServiceRole.entities.PriceListItem.deleteMany({
        source,
        company_id,
      });
      console.log(`🗑️ Cleared current ${source} items`);
    } catch (delErr: any) {
      console.warn(`⚠️ Could not clear current items: ${delErr.message}`);
    }

    // Re-insert backed-up items in batches
    const batchSize = 100;
    let restored = 0;
    const totalBatches = Math.ceil(items.length / batchSize);

    for (let i = 0; i < items.length; i += batchSize) {
      const batchNum = Math.floor(i / batchSize) + 1;
      const batch = items.slice(i, i + batchSize).map((item: any) => ({
        ...item,
        company_id,
      }));

      try {
        await base44.asServiceRole.entities.PriceListItem.bulkCreate(batch);
        restored += batch.length;
        console.log(`✅ Batch ${batchNum}/${totalBatches}: +${batch.length} (total ${restored}/${items.length})`);
      } catch (batchErr: any) {
        console.error(`❌ Batch ${batchNum} failed: ${batchErr.message}`);
        // Retry in smaller sub-batches
        const subBatchSize = 25;
        for (let j = 0; j < batch.length; j += subBatchSize) {
          const sub = batch.slice(j, j + subBatchSize);
          try {
            await base44.asServiceRole.entities.PriceListItem.bulkCreate(sub);
            restored += sub.length;
          } catch (subErr: any) {
            console.error(`  ❌ Sub-batch failed: ${subErr.message}`);
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // Delete the backup once consumed so the banner disappears
    try {
      await base44.asServiceRole.entities.PriceListBackup.delete(backup.id);
    } catch (cleanErr: any) {
      console.warn(`⚠️ Could not delete backup after restore: ${cleanErr.message}`);
    }

    console.log(`✅ Restore complete: ${restored} items restored for source=${source}`);
    return Response.json({ success: true, restored, source });

  } catch (error: any) {
    console.error('❌ Restore error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});
