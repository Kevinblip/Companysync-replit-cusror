import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';

async function fetchImageAsBase64(imageUrl) {
  try {
    console.log('📥 Fetching image:', imageUrl);
    
    const response = await fetch(imageUrl, {
      method: 'GET',
      headers: {
        'Accept': 'image/*'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    
    if (arrayBuffer.byteLength === 0) {
      throw new Error('Image is empty (0 bytes)');
    }
    
    // Convert to base64
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    
    // Detect format
    const contentType = response.headers.get('content-type') || '';
    let format = 'JPEG';
    
    if (contentType.includes('png') || imageUrl.toLowerCase().endsWith('.png')) {
      format = 'PNG';
    } else if (contentType.includes('jpeg') || contentType.includes('jpg') || 
               imageUrl.toLowerCase().endsWith('.jpg') || imageUrl.toLowerCase().endsWith('.jpeg')) {
      format = 'JPEG';
    }
    
    return { base64, format };
    
  } catch (error) {
    console.error('❌ Image fetch failed:', error.message);
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { invoice, customer } = await req.json();

    if (!invoice || !invoice.items || invoice.items.length === 0) {
      // Allow invoices without items if amount is set manually, but warn
      if (!invoice.amount) {
          return Response.json({ error: 'No invoice data provided' }, { status: 400 });
      }
    }

    // Get user's company
    let companies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
    let company = companies[0];
    
    if (!company) {
      const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
      if (staffProfiles.length > 0) {
        const companyId = staffProfiles[0].company_id;
        if (companyId) {
          companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
          company = companies[0];
        }
      }
    }
    
    // Fetch company settings for payment options
    const settings = await base44.asServiceRole.entities.CompanySetting.list();
    const companySettings = settings[0];

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    
    // Use company branding colors
    const hexToRgb = (hex) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : { r: 30, g: 58, b: 138 };
    };
    
    const primaryColor = company?.brand_primary_color 
      ? hexToRgb(company.brand_primary_color) 
      : { r: 30, g: 58, b: 138 };
    
    const darkBlue = primaryColor;
    
    let y = 20;
    let companyY = y;

    // Add company logo
    if (company?.logo_url) {
      try {
        const logoData = await fetchImageAsBase64(company.logo_url);
        if (logoData && logoData.base64 && logoData.base64.length > 100) {
          const maxLogoWidth = 50;
          const maxLogoHeight = 20;
          
          doc.addImage(
            `data:image/${logoData.format.toLowerCase()};base64,${logoData.base64}`,
            logoData.format,
            margin,
            companyY,
            maxLogoWidth,
            maxLogoHeight,
            undefined,
            'FAST'
          );
          companyY += maxLogoHeight + 5;
        }
      } catch (error) {
        console.log('❌ Logo error:', error.message);
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
    
    if (company?.address) {
      doc.text(company.address, margin, companyY);
      companyY += 4.5;
    }
    if (company?.city && company?.state && company?.zip) {
      doc.text(`${company.city}, ${company.state} ${company.zip}`, margin, companyY);
      companyY += 4.5;
    }
    if (company?.phone) {
      doc.text(company.phone, margin, companyY);
      companyY += 4.5;
    }
    if (company?.email) {
      doc.text(company.email, margin, companyY);
    }

    // RIGHT SIDE: INVOICE Title
    y = 20;
    doc.setFontSize(32);
    doc.setTextColor(darkBlue.r, darkBlue.g, darkBlue.b);
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE', pageWidth - margin, y, { align: 'right' });
    
    y += 8;
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.setFont('helvetica', 'normal');
    doc.text(`# ${invoice.invoice_number || 'DRAFT'}`, pageWidth - margin, y, { align: 'right' });
    
    y += 5;
    doc.setFontSize(9);
    
    // Status Badge Logic
    let statusText = (invoice.status || 'DRAFT').toUpperCase();
    let statusColor = [100, 100, 100]; // Gray
    
    if (invoice.status === 'paid') {
        statusColor = [22, 163, 74]; // Green
    } else if (invoice.status === 'overdue') {
        statusColor = [220, 38, 38]; // Red
    } else if (invoice.status === 'sent') {
        statusColor = [37, 99, 235]; // Blue
    }
    
    doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
    doc.text(statusText, pageWidth - margin, y, { align: 'right' });

    // Customer Section (RIGHT SIDE)
    y = 60;
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text('Bill To', pageWidth - margin, y, { align: 'right' });
    
    y += 6;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(invoice.customer_name || 'Customer', pageWidth - margin, y, { align: 'right' });
    
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    
    if (customer?.phone) {
      doc.text(customer.phone, pageWidth - margin, y, { align: 'right' });
      y += 4.5;
    }
    
    if (invoice.customer_email || customer?.email) {
      doc.text(invoice.customer_email || customer.email, pageWidth - margin, y, { align: 'right' });
      y += 4.5;
    }
    
    // Prefer the job-specific property_address from the invoice (copied from the estimate),
    // falling back to the customer's profile address fields.
    const jobAddress = invoice?.property_address
      || invoice?.customer_address
      || (customer?.street ? `${customer.street}, ${customer.city || ''} ${customer.state || ''} ${customer.zip || ''}`.trim() : '');
    if (jobAddress) {
        const addressLines = doc.splitTextToSize(jobAddress, 80);
        addressLines.forEach(line => {
            doc.text(line, pageWidth - margin, y, { align: 'right' });
            y += 4.5;
        });
    }
    
    y += 2;
    doc.text(`Issue Date: ${invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString('en-US') : new Date().toLocaleDateString('en-US')}`, pageWidth - margin, y, { align: 'right' });
    
    if (invoice.due_date) {
        y += 4.5;
        doc.text(`Due Date: ${new Date(invoice.due_date).toLocaleDateString('en-US')}`, pageWidth - margin, y, { align: 'right' });
    }

    if (invoice.claim_number) {
      y += 4.5;
      doc.text(`Claim #: ${invoice.claim_number}`, pageWidth - margin, y, { align: 'right' });
    }

    // LINE ITEMS TABLE - DARK BLUE HEADER
    y = 100;
    
    // Dark blue header background
    doc.setFillColor(darkBlue.r, darkBlue.g, darkBlue.b);
    doc.rect(margin, y, pageWidth - 2 * margin, 8, 'F');
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    
    doc.text('#', margin + 2, y + 5.5);
    doc.text('Item', margin + 12, y + 5.5);
    
    // Fixed column positions
    const qtyCol = 135;
    const rateCol = 160;
    const amountCol = 190;
    
    doc.text('Qty', qtyCol, y + 5.5, { align: 'right' });
    doc.text('Rate', rateCol, y + 5.5, { align: 'right' });
    doc.text('Amount', amountCol, y + 5.5, { align: 'right' });

    y += 10;
    doc.setFont('helvetica', 'normal');

    let subtotal = 0;
    
    if (invoice.items && invoice.items.length > 0) {
        invoice.items.forEach((item, index) => {
        if (y > pageHeight - 40) {
            doc.addPage();
            y = 20;
        }

        // Alternating row colors
        if (index % 2 === 0) {
            doc.setFillColor(248, 250, 252);
            doc.rect(margin, y - 3, pageWidth - 2 * margin, 6, 'F');
        }

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(8);
        
        // Calculate values
        const qty = parseFloat(item.quantity) || 0;
        const rate = parseFloat(item.rate) || 0;
        const amount = parseFloat(item.amount) || 0;
        
        const qtyFormatted = qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2);
        
        // Line number
        doc.text(String(index + 1), margin + 2, y + 2);
        
        // Description - LIMITED WIDTH to not overflow
        const desc = item.description || '';
        const maxDescWidth = 110; 
        const descLines = doc.splitTextToSize(desc, maxDescWidth);
        doc.text(descLines[0] || '', margin + 12, y + 2);
        
        // Numbers
        doc.text(qtyFormatted, qtyCol, y + 2, { align: 'right' });
        doc.text(`$${rate.toFixed(2)}`, rateCol, y + 2, { align: 'right' });
        doc.text(`$${amount.toFixed(2)}`, amountCol, y + 2, { align: 'right' });
        
        subtotal += amount;

        y += 6;
        });
    } else if (invoice.amount) {
        // If no line items but amount exists, use the invoice amount as subtotal
        subtotal = parseFloat(invoice.amount) || 0;
    }

    // Calculations
    let total = subtotal;
    let discount = 0;
    if (invoice.discount_type === "percentage") {
        discount = subtotal * ((invoice.discount_value || 0) / 100);
    } else if (invoice.discount_type === "fixed") {
        discount = invoice.discount_value || 0;
    }
    
    const afterDiscount = subtotal - discount;
    total = afterDiscount + (invoice.adjustment_amount || 0);
    const amountPaid = invoice.amount_paid || 0;
    const amountDue = total - amountPaid;

    // Totals section - ensure we don't overflow page
    if (y > pageHeight - 80) {
      doc.addPage();
      y = 20;
    }
    
    y += 8;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    
    // Subtotal
    doc.text('Sub Total', 100, y);
    doc.text(`$${subtotal.toFixed(2)}`, 190, y, { align: 'right' });
    y += 7;

    // Discount
    if (discount > 0) {
        doc.setTextColor(220, 38, 38); // Red
        doc.text('Discount', 100, y);
        doc.text(`-$${discount.toFixed(2)}`, 190, y, { align: 'right' });
        y += 7;
        doc.setTextColor(0, 0, 0);
    }

    // Adjustment
    if (invoice.adjustment_amount && invoice.adjustment_amount !== 0) {
        doc.text('Adjustment', 100, y);
        const sign = invoice.adjustment_amount > 0 ? '+' : '';
        doc.text(`${sign}$${invoice.adjustment_amount.toFixed(2)}`, 190, y, { align: 'right' });
        y += 7;
    }
    
    y += 3;
    doc.setFontSize(12);
    doc.text('Total', 100, y);
    doc.text(`$${total.toFixed(2)}`, 190, y, { align: 'right' });
    y += 10;

    if (amountPaid > 0) {
        doc.setFontSize(11);
        doc.setTextColor(22, 163, 74); // Green
        doc.text('Amount Paid', 100, y);
        doc.text(`-$${amountPaid.toFixed(2)}`, 190, y, { align: 'right' });
        y += 10;
    }

    doc.setFontSize(14);
    doc.setTextColor(darkBlue.r, darkBlue.g, darkBlue.b);
    doc.text('Amount Due', 100, y);
    doc.text(`$${amountDue.toFixed(2)}`, 190, y, { align: 'right' });

    y += 15;

    // Notes/Terms section
    if (invoice.notes || company?.pdf_terms_conditions) {
      if (y > pageHeight - 50) {
        doc.addPage();
        y = 20;
      }
      
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('Note:', margin, y);
      
      y += 6;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      
      // Combine invoice notes and company terms
      let notesText = invoice.notes || '';
      if (company?.pdf_terms_conditions) {
          notesText += `\n\n${company.pdf_terms_conditions}`;
      }
      
      const notesLines = doc.splitTextToSize(notesText, pageWidth - 2 * margin);
      
      notesLines.forEach(line => {
        if (y > pageHeight - 25) {
          doc.addPage();
          y = 20;
        }
        doc.text(line, margin, y);
        y += 4.5;
      });
    }
    
    // Footer on all pages
    const totalPages = doc.internal.pages.length - 1;
    
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(150, 150, 150);
      
      const footerText = company?.pdf_footer_text || 'Thank you for your business!';
      doc.text(footerText, pageWidth / 2, pageHeight - 15, { align: 'center' });
      
      doc.text(`${i}/${totalPages}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
    }

    const pdfBytes = doc.output('arraybuffer');

    // Upload to storage
    const fileName = `Invoice-${invoice.invoice_number || 'draft'}.pdf`;
    const file = new File([pdfBytes], fileName, { type: 'application/pdf' });

    console.log('📤 Uploading invoice PDF...');
    // Use service role for upload to ensure permissions
    const uploadRes = await base44.asServiceRole.integrations.Core.UploadFile({ file });
    
    if (!uploadRes || !uploadRes.file_url) {
      throw new Error("Upload failed - no file_url returned");
    }

    return Response.json({
      success: true,
      pdf_url: uploadRes.file_url,
      file_name: fileName
    });

  } catch (error) {
    console.error('PDF generation error:', error);
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});