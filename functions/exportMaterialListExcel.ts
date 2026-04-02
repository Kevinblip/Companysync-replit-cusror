import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import ExcelJS from 'npm:exceljs@4.4.0';
import { Buffer } from 'node:buffer';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { items, customerInfo, estimateNumber } = await req.json();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Material List');

    // Add title
    worksheet.mergeCells('A1:D1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = 'Material List';
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: 'center' };

    worksheet.addRow([]); // Spacer

    // Add customer info
    worksheet.addRow(['Customer Name:', customerInfo?.customer_name || '']);
    worksheet.addRow(['Address:', customerInfo?.property_address || '']);
    worksheet.addRow(['Estimate Number:', estimateNumber || '']);
    worksheet.addRow(['Date:', new Date().toLocaleDateString()]);
    worksheet.addRow([]); // Spacer

    // Add headers
    const headerRow = worksheet.addRow(['Code', 'Description', 'Quantity', 'Unit']);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEEEEEE' }
      };
      cell.border = {
        bottom: { style: 'thin' }
      };
    });
    
    // Add items
    if (items && Array.isArray(items)) {
        items.forEach(item => {
             worksheet.addRow([
                 item.code || '',
                 item.description || '',
                 Number(item.quantity) || 0,
                 item.unit || 'EA'
             ]);
        });
    }

    // Formatting
    worksheet.getColumn(1).width = 15;
    worksheet.getColumn(2).width = 60;
    worksheet.getColumn(3).width = 12;
    worksheet.getColumn(4).width = 10;

    // Auto-filter
    worksheet.autoFilter = {
      from: { row: 8, column: 1 },
      to: { row: 8 + (items?.length || 0), column: 4 }
    };

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    return Response.json({
      file: base64,
      filename: `${estimateNumber || 'estimate'}_material_list.xlsx`
    });

  } catch (error) {
    console.error('Excel export error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});