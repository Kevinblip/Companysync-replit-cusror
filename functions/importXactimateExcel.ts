import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import * as XLSX from 'npm:xlsx@0.18.5';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { file_url, company_id } = await req.json();
    
    if (!file_url) {
      return Response.json({ error: 'file_url is required' }, { status: 400 });
    }

    // Determine company ID
    let targetCompanyId = company_id;
    if (!targetCompanyId) {
      const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
      if (staffProfiles.length > 0) {
        targetCompanyId = staffProfiles[0].company_id;
      }
    }
    if (!targetCompanyId) {
      const companies = await base44.entities.Company.filter({ created_by: user.email });
      if (companies.length > 0) {
        targetCompanyId = companies[0].id;
      }
    }

    console.log('Fetching Excel file from:', file_url);
    
    // Fetch the Excel file
    const response = await fetch(file_url);
    if (!response.ok) {
      return Response.json({ error: 'Failed to fetch file' }, { status: 400 });
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    console.log('Found sheets:', workbook.SheetNames.length);
    
    const allItems = [];
    const errors = [];
    
    // Process each sheet
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
        
        // Try to find description in first column
        let description = null;
        let unit = null;
        let removePrice = null;
        let replacePrice = null;
        
        // Look for the description - usually starts with a number like "1.  " or "1,234.  "
        const firstCell = String(row[0] || '').trim();
        
        // Skip header rows
        if (firstCell === 'DESCRIPTION' || firstCell.includes('DESCRIPTION') || 
            firstCell.includes('QTY') || firstCell.includes('Line Items') ||
            firstCell.includes('Main Level') || firstCell.includes('Totals:') ||
            firstCell.includes('CONTINUED -') || !firstCell) {
          continue;
        }
        
        // Match pattern: "123.  Description text" or "1,234.  Description text"
        const lineMatch = firstCell.match(/^[\d,]+\.\s+(.+)/);
        if (lineMatch) {
          description = lineMatch[1].replace(/\n/g, ' ').trim();
        } else if (firstCell && !firstCell.match(/^(REMOVE|REPLACE|TAX|TOTAL|QTY)/)) {
          // Could be a continuation or standalone description
          description = firstCell.replace(/\n/g, ' ').trim();
        }
        
        if (!description || description.length < 3) continue;
        
        // Find unit - look for common units in any column
        for (let j = 1; j < Math.min(row.length, 4); j++) {
          const cell = String(row[j] || '').trim();
          // Match "1.00  EA" or just "SF" or "LF" etc
          const unitMatch = cell.match(/(?:[\d.]+\s+)?(EA|SF|LF|SQ|HR|DA|WK|MO|CY|CF|GAL)/i);
          if (unitMatch) {
            unit = unitMatch[1].toUpperCase();
            break;
          }
        }
        
        // Find prices - look for numeric values
        const numericValues = [];
        for (let j = 1; j < row.length; j++) {
          const val = row[j];
          if (typeof val === 'number' && val >= 0) {
            numericValues.push(val);
          }
        }
        
        // Usually: REMOVE, REPLACE, TAX, TOTAL
        // We want REMOVE (index 0) and REPLACE (index 1)
        if (numericValues.length >= 2) {
          removePrice = numericValues[0];
          replacePrice = numericValues[1];
        } else if (numericValues.length === 1) {
          replacePrice = numericValues[0];
        }
        
        // Use whichever price is higher as the main price
        const price = Math.max(removePrice || 0, replacePrice || 0);
        
        if (price > 0 && description) {
          // Determine category from sheet name or description
          let category = 'Other';
          const sheetLower = sheetName.toLowerCase();
          const descLower = description.toLowerCase();
          
          if (sheetLower.includes('roofing') || descLower.includes('shingle') || descLower.includes('roof')) {
            category = 'Roofing';
          } else if (sheetLower.includes('siding') || descLower.includes('siding')) {
            category = 'Siding';
          } else if (sheetLower.includes('interior') || descLower.includes('plaster') || descLower.includes('drywall')) {
            category = 'Interior';
          } else if (sheetLower.includes('electrical') || descLower.includes('electric') || descLower.includes('wire')) {
            category = 'Electrical';
          } else if (sheetLower.includes('gutter') || sheetLower.includes('fascia') || sheetLower.includes('soffit')) {
            category = 'Exterior';
          } else if (sheetLower.includes('painting') || descLower.includes('paint') || descLower.includes('stain')) {
            category = 'Interior';
          } else if (sheetLower.includes('fencing') || descLower.includes('fence')) {
            category = 'Exterior';
          } else if (sheetLower.includes('insulation')) {
            category = 'Interior';
          } else if (sheetLower.includes('window') || descLower.includes('window')) {
            category = 'Windows';
          } else if (sheetLower.includes('door') || descLower.includes('door')) {
            category = 'Doors';
          }
          
          // Generate a code from the line number
          const codeMatch = firstCell.match(/^([\d,]+)\./);
          const code = codeMatch ? `XAC-${codeMatch[1].replace(',', '')}` : `XAC-${allItems.length + 1}`;
          
          allItems.push({
            code,
            description,
            unit: unit || 'EA',
            price,
            category,
            source: 'Xactimate_New',
            company_id: targetCompanyId,
            is_active: true,
            is_favorite: false
          });
        }
      }
    }
    
    console.log(`Parsed ${allItems.length} items from ${workbook.SheetNames.length} sheets`);
    
    if (allItems.length === 0) {
      return Response.json({ 
        success: false, 
        error: 'No valid items found in the Excel file',
        sheets_processed: workbook.SheetNames.length
      });
    }
    
    // Delete existing Xactimate_New items for this company
    const existingItems = await base44.entities.PriceListItem.filter({ 
      source: 'Xactimate_New',
      company_id: targetCompanyId 
    });
    
    console.log(`Deleting ${existingItems.length} existing Xactimate_New items`);
    
    for (const item of existingItems) {
      await base44.entities.PriceListItem.delete(item.id);
    }
    
    // Import in batches
    const batchSize = 50;
    let imported = 0;
    const failedBatches = [];
    
    for (let i = 0; i < allItems.length; i += batchSize) {
      const batch = allItems.slice(i, i + batchSize);
      
      try {
        await base44.entities.PriceListItem.bulkCreate(batch);
        imported += batch.length;
        console.log(`Imported batch ${Math.floor(i/batchSize) + 1}: ${imported}/${allItems.length}`);
      } catch (err) {
        console.error(`Batch ${Math.floor(i/batchSize) + 1} failed:`, err.message);
        failedBatches.push({ start: i, count: batch.length, error: err.message });
        
        // Try individual inserts for failed batch
        for (const item of batch) {
          try {
            await base44.entities.PriceListItem.create(item);
            imported++;
          } catch (e) {
            errors.push({ item: item.description, error: e.message });
          }
        }
      }
      
      // Small delay between batches
      if (i + batchSize < allItems.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    return Response.json({
      success: true,
      total_sheets: workbook.SheetNames.length,
      total_items_found: allItems.length,
      items_imported: imported,
      errors: errors.length,
      error_details: errors.slice(0, 10),
      failed_batches: failedBatches
    });
    
  } catch (error) {
    console.error('Import error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});