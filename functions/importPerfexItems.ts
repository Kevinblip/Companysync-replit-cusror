import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { fileUrl, targetSource, company_id } = await req.json();
        
        // Determine company_id
        let companyId = company_id;
        if (!companyId) {
            const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
            if (staffProfiles.length > 0 && staffProfiles[0].company_id) {
                companyId = staffProfiles[0].company_id;
            } else {
                const companies = await base44.entities.Company.filter({ created_by: user.email });
                if (companies.length > 0) {
                    companyId = companies[0].id;
                }
            }
        }
        
        if (!companyId) {
            return Response.json({ 
                success: false, 
                error: 'Could not determine company' 
            }, { status: 400 });
        }
        
        console.log('📦 Using company_id:', companyId);

        if (!fileUrl) {
            return Response.json({ 
                success: false, 
                error: 'Missing fileUrl parameter' 
            }, { status: 400 });
        }

        console.log('📥 Starting CSV import from:', fileUrl);
        console.log('🎯 Target source:', targetSource);

        // Fetch the CSV file
        const fileResponse = await fetch(fileUrl);
        if (!fileResponse.ok) {
            return Response.json({
                success: false,
                error: `Failed to fetch file: ${fileResponse.statusText}`
            }, { status: 400 });
        }

        const csvText = await fileResponse.text();
        console.log('📄 CSV file size:', csvText.length, 'characters');

        if (!csvText || csvText.trim().length === 0) {
            return Response.json({
                success: false,
                error: 'CSV file is empty'
            }, { status: 400 });
        }

        // Parse CSV
        const lines = csvText.split('\n').map(line => line.trim()).filter(line => line);
        console.log('📊 Total lines:', lines.length);

        if (lines.length < 2) {
            return Response.json({
                success: false,
                error: 'CSV file must have at least a header row and one data row'
            }, { status: 400 });
        }

        // Parse header
        const header = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        console.log('📋 CSV Headers:', header);

        // Find column indices
        const descIndex = header.findIndex(h => 
            h.toLowerCase().includes('description') || 
            h.toLowerCase().includes('item')
        );
        const rateIndex = header.findIndex(h => 
            h.toLowerCase().includes('rate') || 
            h.toLowerCase().includes('price')
        );
        const unitIndex = header.findIndex(h => 
            h.toLowerCase().includes('unit')
        );
        const categoryIndex = header.findIndex(h => 
            h.toLowerCase().includes('group') || 
            h.toLowerCase().includes('category')
        );

        if (descIndex === -1 || rateIndex === -1) {
            return Response.json({
                success: false,
                error: 'CSV must have Description and Rate/Price columns'
            }, { status: 400 });
        }

        console.log('✅ Column mapping:', { descIndex, rateIndex, unitIndex, categoryIndex });

        // Clear existing items for this source AND company
        const existingItems = await base44.asServiceRole.entities.PriceListItem.filter({ 
            source: targetSource || "Custom",
            company_id: companyId
        });
        
        console.log(`🗑️ Deleting ${existingItems.length} existing items for company ${companyId}...`);
        
        // Bulk delete for speed
        if (existingItems.length > 0) {
            const itemIds = existingItems.map(item => item.id);
            try {
                await base44.asServiceRole.entities.PriceListItem.bulkDelete(itemIds);
                console.log(`✅ Deleted ${itemIds.length} items`);
            } catch (bulkError) {
                console.log('⚠️ Bulk delete failed, trying individual:', bulkError.message);
                for (const item of existingItems) {
                    try {
                        await base44.asServiceRole.entities.PriceListItem.delete(item.id);
                    } catch (deleteError) {
                        console.log(`⚠️ Item ${item.id} already deleted, skipping...`);
                    }
                }
            }
        }

        // Parse and import items
        const items = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;

            // Simple CSV parsing (handles quoted fields)
            const parts = [];
            let current = '';
            let inQuotes = false;
            
            for (let char of line) {
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    parts.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            parts.push(current.trim());

            if (parts.length < Math.max(descIndex, rateIndex) + 1) {
                console.log(`⏭️ Skipping line ${i}: not enough columns`);
                continue;
            }

            const description = parts[descIndex]?.replace(/"/g, '').trim();
            const rateStr = parts[rateIndex]?.replace(/[,$"]/g, '').trim();
            const unit = unitIndex >= 0 ? parts[unitIndex]?.replace(/"/g, '').trim() : 'EA';
            const category = categoryIndex >= 0 ? parts[categoryIndex]?.replace(/"/g, '').trim() : 'Other';

            if (!description || !rateStr) {
                console.log(`⏭️ Skipping line ${i}: missing description or rate`);
                continue;
            }

            const rate = parseFloat(rateStr);
            if (isNaN(rate) || rate <= 0) {
                console.log(`⏭️ Skipping line ${i}: invalid rate "${rateStr}"`);
                continue;
            }

            // Generate code from description
            const code = description
                .replace(/\s+/g, '_')
                .replace(/[^\w_]/g, '')
                .substring(0, 20)
                .toUpperCase();

            items.push({
                code: code || `ITEM_${i}`,
                description: description,
                unit: unit || 'EA',
                price: rate,
                category: category || 'Other',
                source: targetSource || "Custom",
                company_id: companyId
            });
        }

        console.log(`✅ Parsed ${items.length} valid items`);

        if (items.length === 0) {
            return Response.json({
                success: false,
                error: 'No valid items found in CSV'
            }, { status: 400 });
        }

        // Bulk create items
        const batchSize = 50;
        let imported = 0;

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            await base44.asServiceRole.entities.PriceListItem.bulkCreate(batch);
            imported += batch.length;
            console.log(`Progress: ${imported}/${items.length}`);
        }

        console.log('🎉 Import complete!');

        return Response.json({
            success: true,
            imported: imported,
            message: `Successfully imported ${imported} items`
        });

    } catch (error) {
        console.error('❌ Import error:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});