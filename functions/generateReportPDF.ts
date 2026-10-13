import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';
import { jsPDF } from 'npm:jspdf@2.5.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { reportId, reportData, reportName } = await req.json();

    if (!reportData || !Array.isArray(reportData)) {
      return Response.json({ error: 'Invalid report data' }, { status: 400 });
    }

    const doc = new jsPDF();

    // Title
    doc.setFontSize(20);
    doc.text(reportName || 'Report', 20, 20);

    // Date
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 30);

    // Table headers
    doc.setFontSize(12);
    let y = 45;

    if (reportData.length > 0) {
      const columns = Object.keys(reportData[0]);
      
      // Headers
      doc.setFont(undefined, 'bold');
      let x = 20;
      columns.forEach(col => {
        doc.text(col, x, y);
        x += 40;
      });

      // Data rows
      doc.setFont(undefined, 'normal');
      y += 10;

      reportData.slice(0, 30).forEach((row) => { // Limit to 30 rows per page
        let x = 20;
        columns.forEach(col => {
          const value = String(row[col] || '');
          doc.text(value.substring(0, 15), x, y);
          x += 40;
        });
        y += 7;

        if (y > 280) { // New page
          doc.addPage();
          y = 20;
        }
      });
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${reportName || 'report'}.pdf"`
      }
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});