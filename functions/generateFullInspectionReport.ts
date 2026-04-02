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
    console.log(`✅ Image loaded: ${arrayBuffer.byteLength} bytes`);
    
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
    
    console.log(`✅ Image converted to ${format} base64 (${base64.length} chars)`);
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

    const { inspectionJobId } = await req.json();

    console.log('🔍 Generating preview for job:', inspectionJobId);
    
    if (!inspectionJobId) {
      return Response.json({ error: 'Missing inspectionJobId' }, { status: 400 });
    }

    // Fetch inspection job
    const job = await base44.entities.InspectionJob.get(inspectionJobId);
    if (!job) {
      console.error('❌ Job not found:', inspectionJobId);
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }
    
    console.log('✅ Job found:', job.property_address);

    // Fetch media (limit to first 10 photos for preview to avoid timeout)
    const allMedia = await base44.entities.JobMedia.filter({
      related_entity_id: inspectionJobId,
      related_entity_type: 'InspectionJob',
      file_type: 'photo'
    });
    const media = allMedia.slice(0, 10); // Reduced for faster preview

    console.log(`✅ Found ${media.length} photos to include (limited for preview)`);

    // Fetch linked estimate if exists
    let estimate = null;
    if (job.related_estimate_id) {
      try {
        estimate = await base44.entities.Estimate.get(job.related_estimate_id);
        console.log('✅ Estimate found:', estimate.estimate_number);
      } catch (e) {
        console.log('⚠️ Could not fetch estimate:', e.message);
      }
    } else {
      console.log('⚠️ No estimate linked to this job');
    }

    // Fetch company
    let company = null;
    if (job.company_id) {
      const companies = await base44.asServiceRole.entities.Company.filter({ id: job.company_id });
      company = companies[0];
    }
    
    if (!company) {
      console.log('⚠️ No company found, fetching user company');
      const userCompanies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
      company = userCompanies[0];
    }
    
    console.log('✅ Using company:', company?.company_name || 'None');

    // Generate PDF
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - (margin * 2);

    // Brand color
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

    // Cover page with professional design
    let y = 20;
    
    // Add company logo (larger, left-aligned)
    if (company?.logo_url) {
      try {
        console.log('📸 Fetching logo:', company.logo_url);
        const logoResponse = await fetch(company.logo_url);
        const logoBlob = await logoResponse.blob();
        const logoArrayBuffer = await logoBlob.arrayBuffer();
        const logoBase64 = btoa(String.fromCharCode(...new Uint8Array(logoArrayBuffer)));
        const logoFormat = company.logo_url.toLowerCase().endsWith('.png') ? 'PNG' : 'JPEG';
        // Left-align logo to match text position exactly (margin is 20, so 18 is safe)
        doc.addImage(`data:image/${logoFormat.toLowerCase()};base64,${logoBase64}`, logoFormat, 18, y, 60, 25);
        y += 30;
        console.log('✅ Logo added');
      } catch (e) {
        console.log('⚠️ Could not add logo:', e.message);
      }
    }
    
    // Company info - LARGER AND MORE PROMINENT
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(company?.company_name || 'Company Name', margin, y);
    y += 8;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    
    if (company?.address) {
      doc.text(company.address, margin, y);
      y += 5;
    }
    
    if (company?.city || company?.state || company?.zip) {
      const cityStateZip = [company?.city, company?.state, company?.zip].filter(Boolean).join(', ');
      doc.text(cityStateZip, margin, y);
      y += 5;
    }
    
    if (company?.phone) {
      doc.text(`Phone: ${company.phone}`, margin, y);
      y += 5;
    }
    
    if (company?.email) {
      doc.text(`Email: ${company.email}`, margin, y);
      y += 5;
    }
    
    if (company?.company_website) {
      doc.text(`Web: ${company.company_website}`, margin, y);
      y += 5;
    }
    
    // Title section with branded color
    y = 80;
    doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.rect(0, y, pageWidth, 25, 'F');
    
    doc.setFontSize(28);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('INSPECTION REPORT', pageWidth / 2, y + 16, { align: 'center' });
    
    // Property details box
    y = 125;
    doc.setFillColor(245, 247, 250);
    doc.rect(margin, y, contentWidth, 50, 'F');
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('PROPERTY INFORMATION', margin + 5, y + 8);
    
    y += 15;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(60, 60, 60);
    doc.text(`Property Address: ${job.property_address || 'N/A'}`, margin + 5, y);
    y += 5;
    doc.text(`Client Name: ${job.client_name || 'N/A'}`, margin + 5, y);
    y += 5;
    if (job.client_email) {
      doc.text(`Client Email: ${job.client_email}`, margin + 5, y);
      y += 5;
    }
    if (job.client_phone) {
      doc.text(`Client Phone: ${job.client_phone}`, margin + 5, y);
      y += 5;
    }
    doc.text(`Inspection Date: ${new Date(job.inspection_date || job.created_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, margin + 5, y);
    y += 5;
    if (job.insurance_claim_number) {
      doc.text(`Claim Number: ${job.insurance_claim_number}`, margin + 5, y);
      y += 5;
    }
    if (job.insurance_company) {
      doc.text(`Insurance Company: ${job.insurance_company}`, margin + 5, y);
      y += 5;
    }
    
    // Executive Summary
    if (job.notes) {
      y += 10;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
      doc.text('EXECUTIVE SUMMARY', margin, y);
      
      y += 8;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      
      let sectionNotes = {};
      try {
        if (typeof job.notes === 'string' && job.notes.trim()) {
          sectionNotes = JSON.parse(job.notes);
        } else if (typeof job.notes === 'object' && job.notes !== null) {
          sectionNotes = job.notes;
        }
      } catch (e) {
        console.log('⚠️ Could not parse notes as JSON, treating as plain text');
        sectionNotes = { 'Notes': job.notes };
      }
      
      const summaryText = Object.entries(sectionNotes).slice(0, 2).map(([section, note]) => `${section}: ${note}`).join(' ') || 'Complete visual inspection performed.';
      const summaryLines = doc.splitTextToSize(summaryText.substring(0, 300), contentWidth - 10);
      doc.text(summaryLines, margin, y);
    }

    // Add inspection photos section
    if (media.length > 0) {
      console.log('📸 Processing inspection photos...');
      let sectionNotes = {};
      try {
        if (job.notes) {
          if (typeof job.notes === 'string' && job.notes.trim()) {
            sectionNotes = JSON.parse(job.notes);
          } else if (typeof job.notes === 'object' && job.notes !== null) {
            sectionNotes = job.notes;
          }
        }
      } catch (e) {
        console.log('⚠️ Could not parse notes as JSON');
        sectionNotes = {};
      }
      const imagesBySection = {};
      
      media.forEach(item => {
        const section = item.section || 'Other';
        if (!imagesBySection[section]) {
          imagesBySection[section] = [];
        }
        imagesBySection[section].push(item);
      });

      for (const [section, images] of Object.entries(imagesBySection)) {
        try {
          doc.addPage();
          
          // Section header with branded bar
          doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
          doc.rect(0, 10, pageWidth, 12, 'F');
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(255, 255, 255);
          doc.text(section, pageWidth / 2, 18, { align: 'center' });
          
          let yPos = 30;
          
          // Section notes
          if (sectionNotes[section]) {
            try {
              doc.setFontSize(9);
              doc.setFont('helvetica', 'normal');
              doc.setTextColor(60, 60, 60);
              const lines = doc.splitTextToSize(sectionNotes[section], contentWidth);
              doc.text(lines, margin, yPos);
              yPos += (lines.length * 4) + 8;
            } catch (e) {
              console.error('⚠️ Error adding section notes:', e);
            }
          }
          
          // Photos in 2-column grid - FETCH IN PARALLEL FOR SPEED
          console.log(`⏱️ Fetching ${images.length} images in parallel...`);
          const imagePromises = images.map(item => fetchImageAsBase64(item.file_url));
          const imageResults = await Promise.all(imagePromises);
          console.log('✅ All images fetched');
          
          let successfulImages = 0;
          for (let i = 0; i < images.length; i++) {
            const item = images[i];
            const imageData = imageResults[i];
            
            if (!imageData || !imageData.base64) {
              console.error('⚠️ Skipping failed image:', item.file_url);
              continue;
            }
            
            const isLeftColumn = successfulImages % 2 === 0;
            
            if (yPos > pageHeight - 90 && isLeftColumn) {
              doc.addPage();
              doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
              doc.rect(0, 10, pageWidth, 12, 'F');
              doc.setFontSize(14);
              doc.setFont('helvetica', 'bold');
              doc.setTextColor(255, 255, 255);
              doc.text(`${section} (continued)`, pageWidth / 2, 18, { align: 'center' });
              yPos = 30;
            }

            const imgWidth = 85;
            const imgHeight = 60;
            const xPos = isLeftColumn ? margin : (pageWidth / 2 + 5);
            
            try {
              // Photo border
              doc.setDrawColor(200, 200, 200);
              doc.setLineWidth(0.3);
              doc.rect(xPos, yPos, imgWidth, imgHeight);
              
              doc.addImage(
                `data:image/${imageData.format.toLowerCase()};base64,${imageData.base64}`,
                imageData.format,
                xPos + 1,
                yPos + 1,
                imgWidth - 2,
                imgHeight - 2
              );

              // Caption below photo
              if (item.caption) {
                try {
                  doc.setFontSize(7);
                  doc.setFont('helvetica', 'normal');
                  doc.setTextColor(80, 80, 80);
                  const captionLines = doc.splitTextToSize(item.caption, imgWidth);
                  let captionY = yPos + imgHeight + 3;
                  captionLines.slice(0, 2).forEach(line => {
                    doc.text(line, xPos, captionY);
                    captionY += 3;
                  });
                } catch (e) {
                  console.error('⚠️ Error adding caption:', e);
                }
              }
              
              successfulImages++;
              
              // Move to next row after 2 photos
              if (!isLeftColumn || i === images.length - 1) {
                yPos += 75;
              }
            } catch (e) {
              console.error('⚠️ Error adding image to PDF:', e.message);
            }
          }
          
          console.log(`✅ Added ${successfulImages} of ${images.length} images for section: ${section}`);
        } catch (sectionError) {
          console.error(`⚠️ Error processing section ${section}:`, sectionError);
        }
      }
    }

    // Add estimate section with professional table
    if (estimate) {
      try {
        console.log('💰 Adding estimate section...');
        doc.addPage();
      
      // Estimate header
      doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
      doc.rect(0, 10, pageWidth, 12, 'F');
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text('ESTIMATE SUMMARY', pageWidth / 2, 18, { align: 'center' });
      
      let yPos = 35;
      
      // LEFT SIDE: Company Info
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text(company?.company_name || 'Company Name', margin, yPos);
      
      yPos += 5;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      
      if (company?.address) {
        doc.text(company.address, margin, yPos);
        yPos += 4;
      }
      
      if (company?.city || company?.state || company?.zip) {
        const cityStateZip = [company?.city, company?.state, company?.zip].filter(Boolean).join(', ');
        doc.text(cityStateZip, margin, yPos);
        yPos += 4;
      }
      
      if (company?.phone) {
        doc.text(company.phone, margin, yPos);
        yPos += 4;
      }
      
      if (company?.email) {
        doc.text(company.email, margin, yPos);
      }
      
      // RIGHT SIDE: ESTIMATE Title and Number
      let rightY = 35;
      doc.setFontSize(20);
      doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
      doc.setFont('helvetica', 'bold');
      doc.text('ESTIMATE', pageWidth - margin, rightY, { align: 'right' });
      
      rightY += 6;
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.setFont('helvetica', 'normal');
      doc.text(`# ${estimate.estimate_number}`, pageWidth - margin, rightY, { align: 'right' });
      
      rightY += 4;
      doc.text(`${estimate.status?.toUpperCase() || 'DRAFT'}`, pageWidth - margin, rightY, { align: 'right' });
      
      // Customer Section (RIGHT SIDE)
      rightY += 8;
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      doc.text('To', pageWidth - margin, rightY, { align: 'right' });
      
      rightY += 5;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text(estimate.customer_name || job.client_name || 'Customer', pageWidth - margin, rightY, { align: 'right' });
      
      rightY += 5;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      
      if (estimate.customer_phone || job.client_phone) {
        doc.text(estimate.customer_phone || job.client_phone, pageWidth - margin, rightY, { align: 'right' });
        rightY += 4;
      }
      
      if (estimate.customer_email || job.client_email) {
        doc.text(estimate.customer_email || job.client_email, pageWidth - margin, rightY, { align: 'right' });
        rightY += 4;
      }
      
      if (estimate.property_address || job.property_address) {
        const addressLines = doc.splitTextToSize(estimate.property_address || job.property_address, 80);
        addressLines.forEach(line => {
          doc.text(line, pageWidth - margin, rightY, { align: 'right' });
          rightY += 4;
        });
      }
      
      rightY += 2;
      doc.text(`Estimate Date: ${new Date(estimate.created_date).toLocaleDateString('en-US')}`, pageWidth - margin, rightY, { align: 'right' });
      
      if (job.insurance_claim_number) {
        rightY += 4;
        doc.text(`Claim #: ${job.insurance_claim_number}`, pageWidth - margin, rightY, { align: 'right' });
      }
      
      // Move down for table
      yPos = Math.max(yPos, rightY) + 10;
      
      const items = estimate.items || estimate.line_items || [];
      console.log(`📋 Estimate has ${items.length} line items`);
      
      if (items.length > 0) {
        // Table header
        doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
        doc.rect(margin, yPos, contentWidth, 8, 'F');
        
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        doc.text('#', margin + 2, yPos + 5.5);
        doc.text('Description', margin + 10, yPos + 5.5);
        doc.text('Qty', 115, yPos + 5.5, { align: 'right' });
        doc.text('Unit', 130, yPos + 5.5);
        doc.text('Rate', 150, yPos + 5.5, { align: 'right' });
        doc.text('Amount', pageWidth - margin - 2, yPos + 5.5, { align: 'right' });
        
        yPos += 10;
        
        let subtotal = 0;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        
        items.forEach((item, index) => {
          if (yPos > pageHeight - 40) {
            doc.addPage();
            yPos = 20;
          }
          
          // Alternating row colors
          if (index % 2 === 0) {
            doc.setFillColor(248, 250, 252);
            doc.rect(margin, yPos - 3, contentWidth, 6, 'F');
          }
          
          doc.setFontSize(7);
          doc.text(String(index + 1), margin + 2, yPos + 2);
          
          const desc = item.description || 'Item';
          const descLines = doc.splitTextToSize(desc, 95);
          doc.text(descLines[0], margin + 10, yPos + 2);
          
          const qty = parseFloat(item.quantity) || 0;
          const rate = parseFloat(item.rate) || 0;
          const amount = parseFloat(item.amount) || 0;
          
          doc.text(qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2), 115, yPos + 2, { align: 'right' });
          doc.text(item.unit || 'EA', 130, yPos + 2);
          doc.text(`$${rate.toFixed(2)}`, 150, yPos + 2, { align: 'right' });
          doc.text(`$${amount.toFixed(2)}`, pageWidth - margin - 2, yPos + 2, { align: 'right' });
          
          subtotal += amount;
          yPos += 6;
        });
        
        // Total line
        yPos += 5;
        doc.setDrawColor(200, 200, 200);
        doc.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 8;
        
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
        doc.text('TOTAL', 145, yPos);
        doc.text(`$${subtotal.toFixed(2)}`, pageWidth - margin - 2, yPos, { align: 'right' });
      }
      
      console.log('✅ Estimate section added successfully');
      } catch (estimateError) {
        console.error('⚠️ Error adding estimate section:', estimateError);
        // Continue without estimate section if it fails
      }
    }

    // Add signature page
    if (job.inspector_signature) {
      try {
        doc.addPage();
      
      doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
      doc.rect(0, 10, pageWidth, 12, 'F');
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text('INSPECTOR CERTIFICATION', pageWidth / 2, 18, { align: 'center' });
      
      let yPos = 40;
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      const certText = 'I hereby certify that this inspection report accurately reflects the conditions observed at the time of inspection. All findings are based on visual examination and professional assessment.';
      const certLines = doc.splitTextToSize(certText, contentWidth);
      doc.text(certLines, margin, yPos);
      yPos += (certLines.length * 5) + 15;
      
      doc.setFillColor(245, 247, 250);
      doc.rect(margin, yPos, 90, 45, 'F');
      doc.setDrawColor(200, 200, 200);
      doc.rect(margin, yPos, 90, 45);
      
      yPos += 5;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(80, 80, 80);
      doc.text('Inspector Signature:', margin + 5, yPos + 3);
      
      try {
        doc.addImage(job.inspector_signature, 'PNG', margin + 5, yPos + 6, 70, 25);
      } catch (e) {
        console.log('Could not add signature');
      }
      
      yPos += 35;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(`Date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, margin + 5, yPos);
      
      console.log('✅ Signature page added');
      } catch (signatureError) {
        console.error('⚠️ Error adding signature page:', signatureError);
      }
    }
    
    // Add comprehensive disclaimer page
    doc.addPage();
    
    doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.rect(0, 10, pageWidth, 12, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('IMPORTANT DISCLAIMER', pageWidth / 2, 18, { align: 'center' });
    
    let disclaimerY = 35;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    
    const disclaimerText = `INSPECTION REPORT DISCLAIMER AND LIMITATIONS

This inspection report represents the findings and observations made during a visual inspection of the property located at ${job.property_address || 'the subject property'} on ${new Date(job.inspection_date || job.created_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.

SCOPE OF INSPECTION:
This report is based solely on visible, accessible conditions at the time of inspection. The inspection was conducted in accordance with industry standards and represents the professional opinion of the inspector. This is a non-invasive visual inspection and does not include destructive testing, laboratory analysis, or specialized equipment beyond standard inspection tools.

LIMITATIONS:
• This inspection does not include areas that were inaccessible, concealed, or obstructed at the time of inspection
• Weather conditions, debris, or other factors may have limited visibility or access to certain areas
• Not all components may have been tested or operated during the inspection
• Conditions may change after the date of inspection due to weather, usage, or other factors
• This report does not constitute a warranty, guarantee, or insurance policy
• Hidden or latent defects that were not visible during inspection are not included in this report

ACCURACY AND LIABILITY:
While every effort has been made to provide accurate information, ${company?.company_name || 'the inspection company'} makes no warranty or guarantee regarding the accuracy or completeness of this report. The inspector has relied upon information provided by the property owner/client and observable conditions. The client acknowledges that:

• This report is provided for the exclusive use of the client named herein
• Any party relying on this report does so at their own risk
• ${company?.company_name || 'The inspection company'} and its inspectors shall not be liable for any consequential, incidental, or special damages
• The maximum liability shall not exceed the fee paid for this inspection
• This inspection does not guarantee future performance or condition of any component or system

RECOMMENDATIONS:
Any items noted in this report as requiring repair, further evaluation, or monitoring should be addressed by qualified professionals in the respective trades. The client is strongly advised to:

• Obtain estimates and perform necessary repairs before finalizing any real estate transaction
• Have specialized inspections performed where recommended (structural, electrical, plumbing, roofing, etc.)
• Review all repair estimates with qualified contractors
• Understand that repair costs may vary significantly based on materials, labor, and unforeseen conditions

INSURANCE CLAIMS:
If this inspection is related to an insurance claim:
• This report represents observed conditions and estimated repair scopes
• Actual claim settlements are determined by the insurance company and their adjusters
• Supplemental estimates may be necessary as work progresses and additional damage is discovered
• The client should work directly with their insurance company regarding coverage and claim processing
• ${company?.company_name || 'The inspection company'} is not responsible for claim denials or disputes

TIME SENSITIVITY:
This report is valid as of the inspection date only. Conditions may deteriorate or change over time. It is recommended that:
• Repairs be completed in a timely manner
• Re-inspection be performed if significant time has passed since the original inspection
• The property be monitored for changes, especially after severe weather events

ACCEPTANCE:
By accepting this report, the client acknowledges that they have read, understood, and agree to the terms and limitations outlined herein. If the client does not agree with these terms, they should return this report immediately for a full refund of the inspection fee.

For questions or clarifications regarding this report, please contact:
${company?.company_name || 'Inspection Company'}
${company?.phone ? 'Phone: ' + company.phone : ''}
${company?.email ? 'Email: ' + company.email : ''}

Report Prepared By: ${job.assigned_to_name || 'Licensed Inspector'}
Report Date: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
Inspection Date: ${new Date(job.inspection_date || job.created_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

    const disclaimerLines = doc.splitTextToSize(disclaimerText, contentWidth);
    
    disclaimerLines.forEach(line => {
      if (disclaimerY > pageHeight - 25) {
        doc.addPage();
        disclaimerY = 20;
      }
      doc.text(line, margin, disclaimerY);
      disclaimerY += 3.5;
    });
    
    // Add footer to all pages
    const totalPages = doc.internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(150, 150, 150);
      
      // Footer text
      const footerText = `${company?.company_name || 'Inspection Report'} | ${company?.phone || ''} | ${company?.email || ''}`;
      doc.text(footerText, pageWidth / 2, pageHeight - 13, { align: 'center' });
      
      // Page number
      doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
    }

    const pdfBase64 = doc.output('datauristring').split(',')[1];

    console.log('✅ PDF generated successfully');

    return Response.json({
      success: true,
      pdf_base64: pdfBase64
    });

  } catch (error) {
    console.error('❌ PDF Generation Error:', error);
    console.error('Error stack:', error.stack);
    return Response.json({ 
      success: false,
      error: error.message || 'Unknown error occurred',
      details: error.stack,
      errorType: error.constructor.name
    }, { status: 500 });
  }
});