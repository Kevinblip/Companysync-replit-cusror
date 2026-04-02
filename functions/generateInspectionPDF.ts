import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';

async function getImageAsDataUrl(imageUrl) {
  try {
    console.log('📥 Fetching image:', imageUrl);
    
    const response = await fetch(imageUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    console.log(`✅ Downloaded: ${arrayBuffer.byteLength} bytes`);
    
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        ''
      )
    );
    
    // Detect format from URL or content type
    const contentType = response.headers.get('content-type') || '';
    let format = 'JPEG';
    
    if (contentType.includes('png') || imageUrl.toLowerCase().endsWith('.png')) {
      format = 'PNG';
    }
    
    const dataUrl = `data:image/${format.toLowerCase()};base64,${base64}`;
    
    console.log(`✅ Created ${format} data URL (${dataUrl.length} chars)`);
    
    return { dataUrl, format };
    
  } catch (error) {
    console.error('❌ Failed:', error.message);
    throw error;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId, imagesData, sectionNotes, inspectorSignature } = await req.json();

    console.log('📄 PDF Generation Started');
    console.log(`📸 Total images: ${imagesData?.length || 0}`);

    if (!jobId || !imagesData || imagesData.length === 0) {
      return Response.json({ error: 'No images provided' }, { status: 400 });
    }

    const job = await base44.asServiceRole.entities.InspectionJob.get(jobId);
    
    if (!job) {
      return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const companies = await base44.asServiceRole.entities.Company.list('-created_date', 1);
    const company = companies[0];

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });
    
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);
    
    let y = margin;

    // Header
    doc.setFontSize(20);
    doc.setTextColor(37, 99, 235);
    doc.text(company?.company_name || 'Inspection Report', margin, y);
    
    y += 8;
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    if (company?.phone_number) {
      doc.text(company.phone_number, margin, y);
      y += 5;
    }

    // Right side info
    y = margin;
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text('Inspection Report', pageWidth - margin, y, { align: 'right' });
    
    y += 7;
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, pageWidth - margin, y, { align: 'right' });
    
    y += 5;
    if (job.client_name) {
      doc.text(`Client: ${job.client_name}`, pageWidth - margin, y, { align: 'right' });
      y += 5;
    }
    if (job.property_address) {
      const addressLines = doc.splitTextToSize(job.property_address, 70);
      addressLines.forEach(line => {
        doc.text(line, pageWidth - margin, y, { align: 'right' });
        y += 4;
      });
    }

    y = 60;

    // Group images by section
    const imagesBySection = {};
    imagesData.forEach(img => {
      const section = img.section || 'Other';
      if (!imagesBySection[section]) {
        imagesBySection[section] = [];
      }
      imagesBySection[section].push(img);
    });

    console.log(`📊 Sections found: ${Object.keys(imagesBySection).length}`);

    let successCount = 0;
    let failCount = 0;

    // Process sections
    for (const [section, images] of Object.entries(imagesBySection)) {
      console.log(`\n📁 Section: ${section} (${images.length} photos)`);
      
      // Section header
      if (y > pageHeight - 40) {
        doc.addPage();
        y = margin;
      }

      doc.setFontSize(13);
      doc.setTextColor(37, 99, 235);
      doc.text(section, margin, y);
      y += 8;

      // Section notes
      if (sectionNotes && sectionNotes[section]) {
        doc.setFontSize(8);
        doc.setTextColor(60, 60, 60);
        const noteLines = doc.splitTextToSize(sectionNotes[section], contentWidth);
        noteLines.forEach(line => {
          if (y > pageHeight - 15) {
            doc.addPage();
            y = margin;
          }
          doc.text(line, margin, y);
          y += 4;
        });
        y += 3;
      }

      // Process images in this section
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        
        console.log(`\n  📷 Photo ${i + 1}/${images.length}`);
        console.log(`     URL: ${img.imageUrl}`);
        console.log(`     Caption: ${img.caption || 'None'}`);
        
        try {
          // Check if we need a new page
          if (y > pageHeight - 95) {
            doc.addPage();
            y = margin;
            console.log(`     📃 New page created`);
          }

          console.log(`     ⏳ Downloading image...`);
          const { dataUrl, format } = await getImageAsDataUrl(img.imageUrl);
          
          const imgWidth = 90;
          const imgHeight = 65;
          
          console.log(`     🖼️  Adding to PDF: x=${margin}, y=${y}, w=${imgWidth}, h=${imgHeight}`);

          // Add image using data URL
          doc.addImage(dataUrl, format, margin, y, imgWidth, imgHeight);
          
          console.log(`     ✅ SUCCESS - Image embedded`);
          successCount++;

          y += imgHeight + 2;

          // Add caption
          if (img.caption && img.caption.trim() !== '' && img.caption !== 'Photo') {
            doc.setFontSize(8);
            doc.setTextColor(80, 80, 80);
            const captionLines = doc.splitTextToSize(img.caption, imgWidth);
            captionLines.forEach(line => {
              doc.text(line, margin, y);
              y += 3;
            });
          }
          
          y += 5;

        } catch (error) {
          console.error(`     ❌ ERROR: ${error.message}`);
          failCount++;
          
          // Draw placeholder
          doc.setDrawColor(200, 200, 200);
          doc.setFillColor(245, 245, 245);
          doc.rect(margin, y, 90, 65, 'FD');
          
          doc.setFontSize(9);
          doc.setTextColor(150, 150, 150);
          doc.text('Image unavailable', margin + 45, y + 30, { align: 'center' });
          doc.setFontSize(7);
          doc.text(img.caption || 'Photo', margin + 45, y + 37, { align: 'center' });
          
          y += 70;
        }
      }

      y += 5;
    }

    // Signature
    if (inspectorSignature) {
      console.log('\n✍️ Adding signature...');
      
      if (y > pageHeight - 50) {
        doc.addPage();
        y = margin;
      }

      doc.setFontSize(11);
      doc.setTextColor(0, 0, 0);
      doc.text('Inspector Signature:', margin, y);
      y += 8;

      try {
        let sigData = inspectorSignature;
        if (!sigData.startsWith('data:')) {
          sigData = `data:image/png;base64,${sigData.split('base64,')[1] || sigData}`;
        }

        doc.addImage(sigData, 'PNG', margin, y, 50, 25);
        console.log('✅ Signature added');
      } catch (sigError) {
        console.error(`❌ Signature failed: ${sigError.message}`);
      }
    }

    const pdfOutput = doc.output('arraybuffer');

    console.log(`\n📊 SUMMARY:`);
    console.log(`✅ Photos embedded: ${successCount}`);
    console.log(`❌ Photos failed: ${failCount}`);
    console.log(`📄 PDF size: ${(pdfOutput.byteLength / 1024).toFixed(1)}KB`);
    console.log(`📄 Total pages: ${doc.internal.getNumberOfPages()}`);

    return new Response(pdfOutput, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="inspection-${Date.now()}.pdf"`
      }
    });

  } catch (error) {
    console.error('❌ FATAL ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});