import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';

async function fetchImageAsBase64(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) throw new Error('Empty image');
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const contentType = response.headers.get('content-type') || '';
    let format = 'JPEG';
    if (contentType.includes('png') || imageUrl.toLowerCase().endsWith('.png')) format = 'PNG';
    return { base64, format };
  } catch (error) {
    console.error('Image fetch failed:', error.message);
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    // 1. Skip Auth for public access
    const base44 = createClientFromRequest(req, { skipAuth: true });
    
    // 2. Get ID from query params
    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return Response.json({ error: 'Missing id' }, { status: 400 });
    }

    // 3. Fetch Data using Service Role
    const estimates = await base44.asServiceRole.entities.Estimate.filter({ id });
    const estimate = estimates[0];

    if (!estimate) {
      return Response.json({ error: 'Estimate not found' }, { status: 404 });
    }

    let company = null;
    if (estimate.company_id) {
        const companies = await base44.asServiceRole.entities.Company.filter({ id: estimate.company_id });
        company = companies[0];
    } else {
         // Fallback: try to find company by creator
         const companies = await base44.asServiceRole.entities.Company.filter({ created_by: estimate.created_by });
         company = companies[0];
    }

    // 4. Generate PDF (Logic from generateEstimatePDF)
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    
    const hexToRgb = (hex) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } 
                    : { r: 30, g: 58, b: 138 };
    };
    
    const primaryColor = company?.brand_primary_color ? hexToRgb(company.brand_primary_color) : { r: 30, g: 58, b: 138 };
    const darkBlue = primaryColor;
    
    let y = 20;
    let companyY = y;

    // Logo
    if (company?.logo_url) {
      const logoData = await fetchImageAsBase64(company.logo_url);
      if (logoData) {
        doc.addImage(`data:image/${logoData.format.toLowerCase()};base64,${logoData.base64}`, logoData.format, margin, companyY, 50, 20, undefined, 'FAST');
        companyY += 25;
      }
    }

    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text(company?.company_name || 'Your Company', margin, companyY);
    companyY += 6;
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    if (company?.address) { doc.text(company.address, margin, companyY); companyY += 4.5; }
    if (company?.city) { doc.text(`${company.city}, ${company.state || ''} ${company.zip || ''}`, margin, companyY); companyY += 4.5; }
    if (company?.phone) { doc.text(company.phone, margin, companyY); companyY += 4.5; }
    if (company?.email) { doc.text(company.email, margin, companyY); }

    // ESTIMATE Header
    y = 20;
    doc.setFontSize(32);
    doc.setTextColor(darkBlue.r, darkBlue.g, darkBlue.b);
    doc.setFont('helvetica', 'bold');
    doc.text('ESTIMATE', pageWidth - margin, y, { align: 'right' });
    y += 8;
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.setFont('helvetica', 'normal');
    doc.text(`# ${estimate.estimate_number || 'DRAFT'}`, pageWidth - margin, y, { align: 'right' });
    
    // Customer Info
    y = 60;
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text('To', pageWidth - margin, y, { align: 'right' });
    y += 6;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(estimate.customer_name || 'Customer', pageWidth - margin, y, { align: 'right' });
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    if (estimate.customer_phone) { doc.text(estimate.customer_phone, pageWidth - margin, y, { align: 'right' }); y += 4.5; }
    if (estimate.customer_email) { doc.text(estimate.customer_email, pageWidth - margin, y, { align: 'right' }); y += 4.5; }
    if (estimate.property_address) {
       const lines = doc.splitTextToSize(estimate.property_address, 80);
       lines.forEach(l => { doc.text(l, pageWidth - margin, y, { align: 'right' }); y += 4.5; });
    }
    
    // Table Header
    y = 100;
    doc.setFillColor(darkBlue.r, darkBlue.g, darkBlue.b);
    doc.rect(margin, y, pageWidth - 2 * margin, 8, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('#', margin + 2, y + 5.5);
    doc.text('Item', margin + 12, y + 5.5);
    doc.text('Qty', 120, y + 5.5, { align: 'right' });
    doc.text('Unit', 135, y + 5.5);
    doc.text('Rate', 150, y + 5.5, { align: 'right' });
    doc.text('Amount', 190, y + 5.5, { align: 'right' });
    
    y += 10;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    
    let subtotal = 0;
    (estimate.items || []).forEach((item, index) => {
        if (y > pageHeight - 40) { doc.addPage(); y = 20; }
        if (index % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(margin, y - 3, pageWidth - 2 * margin, 6, 'F'); }
        
        const qty = parseFloat(item.quantity) || 0;
        const rate = parseFloat(item.rate) || 0;
        const amount = parseFloat(item.amount) || parseFloat(item.rcv) || 0;
        subtotal += amount;

        doc.text(String(index + 1), margin + 2, y + 2);
        const desc = item.name || item.description || '';
        doc.text(doc.splitTextToSize(desc, 90)[0], margin + 12, y + 2);
        doc.text(qty.toFixed(2), 120, y + 2, { align: 'right' });
        doc.text(item.unit || 'EA', 135, y + 2);
        doc.text(`$${rate.toFixed(2)}`, 150, y + 2, { align: 'right' });
        doc.text(`$${amount.toFixed(2)}`, 190, y + 2, { align: 'right' });
        y += 6;
    });

    // Totals
    y += 5;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.text('Total', 145, y);
    doc.text(`$${subtotal.toFixed(2)}`, 190, y, { align: 'right' });

    // Notes & Disclaimer
    y += 15;
    if (estimate.notes || company?.pdf_terms_conditions) {
        if (y > pageHeight - 50) { doc.addPage(); y = 20; }
        doc.setFontSize(10);
        doc.text('Notes / Terms:', margin, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        const notes = (estimate.notes || '') + '\n\n' + (company?.pdf_terms_conditions || '');
        const lines = doc.splitTextToSize(notes, pageWidth - 2 * margin);
        lines.forEach(l => {
            if (y > pageHeight - 20) { doc.addPage(); y = 20; }
            doc.text(l, margin, y);
            y += 4;
        });
    }

    const pdfBytes = doc.output('arraybuffer');
    
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="estimate-${estimate.estimate_number}.pdf"`,
        'Cache-Control': 'no-cache'
      }
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});