import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jsPDF } from 'npm:jspdf@2.5.1';

// Robust image fetching - matches generateFullInspectionReport
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
    console.log(`✅ Image loaded: ${arrayBuffer.byteLength} bytes`);
    
    if (arrayBuffer.byteLength === 0) {
      throw new Error('Image is empty (0 bytes)');
    }
    
    // Convert to base64 using loop (more reliable than spread operator for large files)
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    
    // Detect format from content-type header first, then URL
    const contentType = response.headers.get('content-type') || '';
    let format = 'PNG'; // Default to PNG
    
    if (contentType.includes('jpeg') || contentType.includes('jpg')) {
      format = 'JPEG';
    } else if (contentType.includes('png')) {
      format = 'PNG';
    } else if (imageUrl.toLowerCase().includes('.jpg') || imageUrl.toLowerCase().includes('.jpeg')) {
      format = 'JPEG';
    }
    
    console.log(`✅ Image converted to ${format} base64 (${base64.length} chars), content-type: ${contentType}`);
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

    const body = await req.json();
    const { estimate, customerInfo, format, satelliteImageUrl, inspectionPhotos, returnBase64, impersonated_company_id } = body;

    console.log('📋 PDF Generation Request:', {
      has_estimate: !!estimate,
      has_customerInfo: !!customerInfo,
      format_id: format?.id,
      returnBase64,
      impersonated_company_id
    });

    if (!estimate || !estimate.line_items || estimate.line_items.length === 0) {
      return Response.json({ error: 'No estimate data provided' }, { status: 400 });
    }

    // Get company - PRIORITY: 1. Estimate's company_id, 2. Impersonation, 3. Staff profile, 4. Owned
    let company = null;
    
    // FIRST: Use the estimate's company_id if available (ensures correct branding per estimate)
    if (estimate.company_id) {
      const estimateCompanies = await base44.asServiceRole.entities.Company.filter({ id: estimate.company_id });
      company = estimateCompanies[0];
      console.log('🏢 Using estimate company_id:', company?.company_name, 'brand_primary_color:', company?.brand_primary_color);
    }
    
    // SECOND: Check for impersonation override
    if (!company && impersonated_company_id) {
      const impersonatedCompanies = await base44.asServiceRole.entities.Company.filter({ id: impersonated_company_id });
      company = impersonatedCompanies[0];
      console.log('🏢 Using impersonated company:', company?.company_name, 'brand_primary_color:', company?.brand_primary_color);
    }
    
    // THIRD: Check staff profile
    if (!company) {
      const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
      if (staffProfiles.length > 0) {
        const companyId = staffProfiles[0].company_id;
        if (companyId) {
          const staffCompanies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
          company = staffCompanies[0];
          console.log('🏢 Using company from staff profile:', company?.company_name);
        }
      }
    }
    
    // FOURTH: Fallback to owned company - get the MOST RECENT one
    if (!company) {
      const ownedCompanies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email, is_deleted: { $ne: true } });
      if (ownedCompanies.length > 0) {
        ownedCompanies.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
        company = ownedCompanies[0];
        console.log('🏢 Using newest owned company:', company?.company_name, 'created:', company?.created_date);
      }
    }

    console.log('🏢 Company loaded:', {
      found: !!company,
      name: company?.company_name,
      has_logo_url: !!company?.logo_url,
      has_logo_base64: !!company?.logo_base64,
      logo_base64_length: company?.logo_base64?.length
    });

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    
    // Get color based on format color_scheme OR company branding
    const hexToRgb = (hex) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : { r: 30, g: 58, b: 138 };
    };
    
    // PRIORITY: 1. Format color_scheme, 2. Company brand color, 3. Default blue
    let headerColor;
    let accentColor;
    
    console.log('🎨 Color Debug:', {
      format_color_scheme: format?.color_scheme,
      company_brand_primary_color: company?.brand_primary_color,
      company_brand_secondary_color: company?.brand_secondary_color
    });
    
    if (format?.color_scheme) {
      const colorMap = {
        red: { r: 220, g: 38, b: 38 },     // Red-600
        green: { r: 22, g: 163, b: 74 },   // Green-600
        blue: { r: 37, g: 99, b: 235 },    // Blue-600
        gray: { r: 75, g: 85, b: 99 }      // Gray-600
      };
      headerColor = colorMap[format.color_scheme] || colorMap.blue;
      accentColor = headerColor; // Same color if using format scheme
      console.log('🎨 Using format color_scheme:', format.color_scheme, headerColor);
    } else if (company?.brand_primary_color) {
      headerColor = hexToRgb(company.brand_primary_color);
      accentColor = company?.brand_secondary_color ? hexToRgb(company.brand_secondary_color) : headerColor;
      console.log('🎨 Using company brand_primary_color:', company.brand_primary_color, headerColor);
      console.log('🎨 Using company brand_secondary_color:', company.brand_secondary_color, accentColor);
    } else {
      headerColor = { r: 59, g: 130, b: 246 }; // Default blue-500
      accentColor = { r: 139, g: 92, b: 246 }; // Default purple-500
      console.log('🎨 Using default blue');
    }
    
    const darkBlue = headerColor;
    
    let y = 20;

    // Company info starts at top
    let companyY = y;

    // Add company logo - matching generateInvoicePDF approach
    if (company?.logo_url && company?.pdf_show_logo !== false) {
      try {
        console.log('📸 Fetching logo:', company.logo_url);
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
          console.log('✅ Logo added successfully');
        } else {
          console.log('⚠️ Logo data invalid, skipping');
        }
      } catch (error) {
        console.log('❌ Logo error:', error.message);
      }
    }

    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text(company?.company_name || company?.name || 'Your Company', margin, companyY);
    
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

    // RIGHT SIDE: ESTIMATE Title
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
    
    y += 5;
    doc.setFontSize(9);
    doc.text(`DRAFT`, pageWidth - margin, y, { align: 'right' });

    // Customer Section (RIGHT SIDE)
    y = 45;
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text('To', pageWidth - margin, y, { align: 'right' });
    
    y += 6;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(customerInfo?.customer_name || 'Customer', pageWidth - margin, y, { align: 'right' });
    
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    
    if (customerInfo?.customer_phone) {
      doc.text(customerInfo.customer_phone, pageWidth - margin, y, { align: 'right' });
      y += 4.5;
    }
    
    if (customerInfo?.customer_email) {
      doc.text(customerInfo.customer_email, pageWidth - margin, y, { align: 'right' });
      y += 4.5;
    }
    
    if (customerInfo?.property_address) {
      const addressLines = doc.splitTextToSize(customerInfo.property_address, 80);
      addressLines.forEach(line => {
        doc.text(line, pageWidth - margin, y, { align: 'right' });
        y += 4.5;
      });
    }
    
    y += 2;
    doc.text(`Estimate Date: ${new Date().toLocaleDateString('en-US')}`, pageWidth - margin, y, { align: 'right' });
    
    if (customerInfo?.claim_number) {
      y += 4.5;
      doc.text(`Claim #: ${customerInfo.claim_number}`, pageWidth - margin, y, { align: 'right' });
    }

    if (customerInfo?.adjuster_name) {
      y += 4.5;
      doc.text(`Adjuster: ${customerInfo.adjuster_name}`, pageWidth - margin, y, { align: 'right' });
    }

    if (customerInfo?.adjuster_phone) {
      y += 4.5;
      doc.text(`Adjuster Ph: ${customerInfo.adjuster_phone}`, pageWidth - margin, y, { align: 'right' });
    }

    // Horizontal separator line before estimate details (like in preview)
    y = 95;
    doc.setDrawColor(darkBlue.r, darkBlue.g, darkBlue.b);
    doc.setLineWidth(1.5);
    doc.line(margin, y, pageWidth - margin, y);
    
    // LINE ITEMS TABLE - DARK BLUE HEADER
    y = 100;
    
    // Dark blue header background with border
    doc.setFillColor(darkBlue.r, darkBlue.g, darkBlue.b);
    doc.setDrawColor(darkBlue.r, darkBlue.g, darkBlue.b);
    doc.setLineWidth(0.5);
    doc.rect(margin, y, pageWidth - 2 * margin, 8, 'FD');
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    
    // A format must opt into the insurance presentation. Retail estimates
    // retain their stored RCV fields for compatibility, but show customers a
    // standard Amount/Total proposal rather than claim-settlement values.
    const isInsuranceFormat = format?.category === 'insurance';
    const showRcvAcv = format?.show_rcv_acv === true
      || (isInsuranceFormat && format?.show_rcv_acv !== false);
    const showDepreciation = showRcvAcv && format?.show_depreciation === true;
    const showAgeLife = showRcvAcv && format?.show_age_life === true;
    const showOpColumn = showRcvAcv && format?.show_op_column === true;
    const defaultOpComponent = Number(format?.overhead_profit_rate ?? 20) / 2;
    const opRate = (Number(estimate.overhead_pct ?? defaultOpComponent) +
      Number(estimate.profit_pct ?? defaultOpComponent)) / 100;

    // Standard column positions
    const sfQtyCol = 90;
    const sfUnitCol = 105;
    const sfRateCol = 122;
    const sfRcvCol = 140;
    const sfDepCol = 155;
    const sfAcvCol = 170;
    // O&P column positions (compressed to fit Tax + O&P columns)
    const opQtyCol = 82, opUnitCol = 86, opRateCol = 101, opTaxCol = 116, opOpCol = 133, opRcvCol = 150, opDepCol = 163, opAcvCol = 183;

    doc.text('#', margin + 2, y + 5.5);
    doc.text('Description', margin + 10, y + 5.5);
    if (showOpColumn) {
      doc.text('Qty', opQtyCol, y + 5.5, { align: 'right' });
      doc.text('Unit', opUnitCol, y + 5.5, { align: 'left' });
      doc.text('Rate', opRateCol, y + 5.5, { align: 'right' });
      doc.text('Tax', opTaxCol, y + 5.5, { align: 'right' });
      doc.text('O&P', opOpCol, y + 5.5, { align: 'right' });
      doc.text(format?.rcv_label || 'RCV', opRcvCol, y + 5.5, { align: 'right' });
      doc.text('Dep%', opDepCol, y + 5.5, { align: 'right' });
      doc.text(format?.acv_label || 'ACV', opAcvCol, y + 5.5, { align: 'right' });
    } else {
      doc.text('Qty', sfQtyCol, y + 5.5, { align: 'right' });
      doc.text('Unit', sfUnitCol, y + 5.5, { align: 'left' });
      doc.text('Rate', sfRateCol, y + 5.5, { align: 'right' });
      if (showRcvAcv) {
        doc.text(format?.rcv_label || 'RCV', sfRcvCol, y + 5.5, { align: 'right' });
        if (showDepreciation || showAgeLife) {
          doc.text('Dep %', sfDepCol, y + 5.5, { align: 'right' });
        }
        doc.text(format?.acv_label || 'ACV', sfAcvCol, y + 5.5, { align: 'right' });
      } else {
        doc.text('Amount', sfAcvCol, y + 5.5, { align: 'right' });
      }
    }

    y += 10;
    doc.setFont('helvetica', 'normal');

    let subtotal = 0;
    
    estimate.line_items.forEach((item, index) => {
      if (y > pageHeight - 40) {
        doc.addPage();
        y = 20;
      }

      const qty = parseFloat(item.quantity) || 0;
      const rate = parseFloat(item.rate) || 0;
      const rcv = parseFloat(item.rcv) || 0;
      const acv = parseFloat(item.acv) || 0;
      const amount = parseFloat(item.amount) || (qty * rate);
      const itemTax = parseFloat(item.tax) || 0;
      const itemOp = Number(item.op_amount ?? item.overhead_profit ?? (amount * opRate));
      const displayRcv = rcv || (amount + itemTax + itemOp);
      const displayAcv = acv || displayRcv;
      const qtyFormatted = qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2);

      const rowHeight = 15;
      if (index % 2 === 0) {
        doc.setFillColor(250, 250, 250);
      } else {
        doc.setFillColor(255, 255, 255);
      }
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.3);
      doc.rect(margin, y - 2, pageWidth - 2 * margin, rowHeight, 'FD');

      doc.setTextColor(0, 0, 0);
      doc.setFontSize(9);

      doc.text(String(index + 1), margin + 2, y + 4);
      const desc = item.description || '';
      const descLines = doc.splitTextToSize(desc, pageWidth - 2 * margin - 12);
      doc.text(descLines[0] || '', margin + 10, y + 4);

      const numY = y + 10;
      const rawUnit = (item.unit || 'EA').trim();
      const unitDisplay = rawUnit.length > 4 ? rawUnit.substring(0, 3) + '…' : rawUnit;

      if (showOpColumn) {
        doc.text(qtyFormatted, opQtyCol, numY, { align: 'right' });
        doc.text(unitDisplay, opUnitCol, numY, { align: 'left' });
        doc.text(`$${rate.toFixed(2)}`, opRateCol, numY, { align: 'right' });
        doc.text(itemTax > 0 ? `$${itemTax.toFixed(2)}` : '0.00', opTaxCol, numY, { align: 'right' });
        doc.text(`$${itemOp.toFixed(2)}`, opOpCol, numY, { align: 'right' });
        doc.text(`$${displayRcv.toFixed(2)}`, opRcvCol, numY, { align: 'right' });
        const depPercent = parseFloat(item.depreciation_percent) || 0;
        doc.text(depPercent > 0 ? `${depPercent.toFixed(0)}%` : 'NA', opDepCol, numY, { align: 'right' });
        doc.text(`$${displayAcv.toFixed(2)}`, opAcvCol, numY, { align: 'right' });
        subtotal += displayRcv;
      } else if (showRcvAcv) {
        doc.text(qtyFormatted, sfQtyCol, numY, { align: 'right' });
        doc.text(unitDisplay, sfUnitCol, numY, { align: 'left' });
        doc.text(`$${rate.toFixed(2)}`, sfRateCol, numY, { align: 'right' });
        doc.text(`$${rcv.toFixed(2)}`, sfRcvCol, numY, { align: 'right' });
        if (showAgeLife || showDepreciation) {
          const depPercent = parseFloat(item.depreciation_percent) || 0;
          doc.text(depPercent > 0 ? `${depPercent.toFixed(0)}%` : '0%', sfDepCol, numY, { align: 'right' });
        }
        doc.text(`$${acv.toFixed(2)}`, sfAcvCol, numY, { align: 'right' });
        subtotal += acv;
      } else {
        doc.text(qtyFormatted, sfQtyCol, numY, { align: 'right' });
        doc.text(unitDisplay, sfUnitCol, numY, { align: 'left' });
        doc.text(`$${rate.toFixed(2)}`, sfRateCol, numY, { align: 'right' });
        doc.text(`$${amount.toFixed(2)}`, sfAcvCol, numY, { align: 'right' });
        subtotal += amount;
      }

      y += 15;
      
      // Add long_description (building code details) if present
      if (item.long_description && item.long_description.trim()) {
        if (y > pageHeight - 40) {
          doc.addPage();
          y = 20;
        }
        
        doc.setFontSize(7);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(80, 80, 80);
        
        const longDescLines = doc.splitTextToSize(item.long_description, pageWidth - 2 * margin - 24);
        longDescLines.forEach(line => {
          if (y > pageHeight - 25) {
            doc.addPage();
            y = 20;
          }
          doc.text(line, margin + 24, y);
          y += 3.5;
        });
        
        y += 2;
        doc.setFont('helvetica', 'normal');
      }
    });

    // Totals section - ensure we don't overflow page
    if (y > pageHeight - 60) {
      doc.addPage();
      y = 20;
    }
    
    y += 8;
    
    // SUBTOTAL ROW with colored background and border
    const totalsRowHeight = 8;
    doc.setFillColor(darkBlue.r, darkBlue.g, darkBlue.b);
    doc.setDrawColor(darkBlue.r, darkBlue.g, darkBlue.b);
    doc.setLineWidth(0.5);
    doc.rect(margin, y - 2, pageWidth - 2 * margin, totalsRowHeight, 'FD');
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('SUBTOTAL:', 100, y + 4);
    doc.text(`$${subtotal.toFixed(2)}`, 190, y + 4, { align: 'right' });
    
    y += totalsRowHeight + 6;
    
    // TOTAL ROW with SECONDARY/ACCENT color background
    doc.setFillColor(accentColor.r, accentColor.g, accentColor.b);
    doc.setDrawColor(accentColor.r, accentColor.g, accentColor.b);
    doc.rect(margin, y - 2, pageWidth - 2 * margin, totalsRowHeight, 'FD');
    
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text('TOTAL:', 100, y + 4);
    doc.text(`$${subtotal.toFixed(2)}`, 190, y + 4, { align: 'right' });

    y += 15;

    // Notes/Terms section
    if (customerInfo?.notes || company?.pdf_terms_conditions) {
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
      
      const notesText = customerInfo?.notes || company?.pdf_terms_conditions || '';
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

    // DISCLAIMER PAGE
    doc.addPage();
    y = 20;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('NOTE:', margin, y);
    
    y += 6;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    
    const disclaimerText = showRcvAcv
      ? `This price is only valid for 30 days from estimate date, and is based on a deposit of half down upon acceptance of estimate and the remaining half due upon completion of work.

The estimate is hereby based on seen, disclosed, or otherwise obvious damage. The repair of the covered loss may be higher than these figures because of other circumstances not yet discovered. Included in this estimate are the items that the Contractor believes necessary to return the property to pre loss condition.

Unseen, undisclosed, or otherwise not obvious conditions, if discovered later or during the course of repairs, will be considered not included.

If discovered, any necessary additional repairs will be submitted for supplemental coverage, based on current market pricing.

Terms & Conditions:

The following estimate is only an approximation of the damages suffered, or expenses incurred, by the insured. No warranty or representation with regard to the accuracy of the estimate is expressed or implied and none should be inferred. The actual damages suffered, or expenses incurred, could be higher or lower than the estimate, even significantly, depending on variances in a number of factors affecting the estimate and the accuracy of the information and assumptions upon which the estimate is based. The estimate is based upon, among other things: information provided to us by the insured; our own observations; measurements taken by our own representatives, the insured and others engaged by the insured; as well as certain assumptions made by us.

Many factors may effect the amount of the estimate where compensation has already been received by the insured for the damage, and with regard to which payment we were not informed; the cost of one contractor varying from another contractor as a result of a number of factors, including, without limitation, the quality of the work, the quality of the materials, or warranties provided by such contractors; damages that were not observed at the time the estimate was rendered because of a lack of accessibility or weather; and all other factors beyond our reasonable control.

Due to rapidly changing material and labor costs, the Insured retains the right to supplement or amend any part of this estimate at a later date should new information comes to light.

This estimate has been calculated for informational purposes only, and is based upon our good faith belief as the damages suffered or expenses incurred as a result of the particular loss, and only represents one opinion as to the method of repair, restoration, or replacement.

Any reliance on the estimate is at your own risk and you agree to hold ${company?.company_name || 'Your Insurance Claims Network'}, its representatives, employees, agents, officers, and principals harmless in the event of such reliance.`
      : `This estimate is valid for 30 days from the estimate date. Pricing is based on the scope of work, materials, labor, and site conditions visible or disclosed at the time this estimate was prepared.

Work outside the listed scope, including concealed damage or conditions discovered after work begins, is not included. Any additional work will be discussed and approved before it is performed.

Material and labor prices can change. This proposal is a good-faith retail estimate for the work described and is not an insurance claim settlement, appraisal, or guarantee of coverage.`;

    const disclaimerLines = doc.splitTextToSize(disclaimerText, pageWidth - 2 * margin);
    
    disclaimerLines.forEach(line => {
      if (y > pageHeight - 25) {
        doc.addPage();
        y = 20;
      }
      doc.text(line, margin, y);
      y += 4;
    });

    // Append company's custom disclaimer if set in Settings
    if (company?.default_estimate_disclaimer) {
      y += 6;
      if (y > pageHeight - 25) { doc.addPage(); y = 20; }
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('Warranty & Additional Terms:', margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const customLines = doc.splitTextToSize(company.default_estimate_disclaimer, pageWidth - 2 * margin);
      customLines.forEach(line => {
        if (y > pageHeight - 25) { doc.addPage(); y = 20; }
        doc.text(line, margin, y);
        y += 4;
      });
    }
    
    // Contact info at bottom
    y += 6;
    if (y > pageHeight - 40) {
      doc.addPage();
      y = 20;
    }
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(user?.full_name || 'Production Manager', margin, y);
    y += 5;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    if (company?.address) {
      doc.text(company.address, margin, y);
      y += 4;
    }
    if (company?.city && company?.state && company?.zip) {
      doc.text(`${company.city}, ${company.state} ${company.zip}`, margin, y);
    }

    // Inspection photos section - SKIP to avoid timeout
    // Photos removed to ensure fast PDF generation

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

    if (returnBase64) {
      const pdfBase64 = doc.output('datauristring').split(',')[1];
      return Response.json({ base64: pdfBase64 });
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=estimate-${customerInfo?.customer_name || 'draft'}.pdf`
      }
    });

  } catch (error) {
    console.error('PDF generation error:', error);
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});