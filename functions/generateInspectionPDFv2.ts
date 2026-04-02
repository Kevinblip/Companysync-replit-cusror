import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId, imagesData, sectionNotes, inspectorSignature } = await req.json();

    console.log('🆕 NEW PDF Generator V2');
    console.log(`📸 Images to embed: ${imagesData?.length || 0}`);

    if (!jobId || !imagesData || imagesData.length === 0) {
      return Response.json({ error: 'No data provided' }, { status: 400 });
    }

    const job = await base44.asServiceRole.entities.InspectionJob.get(jobId);
    const companies = await base44.asServiceRole.entities.Company.list('-created_date', 1);
    const company = companies[0];

    // Create PDF with explicit settings
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'letter',
      putOnlyUsedFonts: true,
      compress: false // IMPORTANT: Don't compress for debugging
    });
    
    const pageW = 216; // Letter width in mm
    const pageH = 279; // Letter height in mm
    let yPos = 20;

    // === HEADER ===
    doc.setFontSize(18);
    doc.setTextColor(0, 0, 0);
    doc.text(company?.company_name || 'Inspection Report', 20, yPos);
    
    yPos += 10;
    doc.setFontSize(9);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, yPos);
    
    yPos += 6;
    if (job.client_name) {
      doc.text(`Client: ${job.client_name}`, 20, yPos);
      yPos += 6;
    }
    if (job.property_address) {
      doc.text(`Property: ${job.property_address}`, 20, yPos);
      yPos += 6;
    }

    yPos = 50;

    // Group by section
    const sections = {};
    for (const img of imagesData) {
      const sec = img.section || 'Other';
      if (!sections[sec]) sections[sec] = [];
      sections[sec].push(img);
    }

    let photoCount = 0;
    let errorCount = 0;

    // Process each section
    for (const [sectionName, photos] of Object.entries(sections)) {
      console.log(`\n📁 ${sectionName}: ${photos.length} photos`);
      
      // Section title
      if (yPos > pageH - 30) {
        doc.addPage();
        yPos = 20;
      }
      
      doc.setFontSize(12);
      doc.setTextColor(37, 99, 235);
      doc.text(sectionName, 20, yPos);
      yPos += 8;

      // Section notes
      if (sectionNotes?.[sectionName]) {
        doc.setFontSize(8);
        doc.setTextColor(60, 60, 60);
        const lines = doc.splitTextToSize(sectionNotes[sectionName], 175);
        lines.forEach(line => {
          if (yPos > pageH - 15) {
            doc.addPage();
            yPos = 20;
          }
          doc.text(line, 20, yPos);
          yPos += 4;
        });
        yPos += 3;
      }

      // Process photos
      for (const photo of photos) {
        photoCount++;
        console.log(`\n  📷 Photo ${photoCount}: ${photo.imageUrl}`);
        
        try {
          // Check space
          if (yPos > pageH - 85) {
            doc.addPage();
            yPos = 20;
          }

          // Fetch image
          console.log('     Downloading...');
          const response = await fetch(photo.imageUrl);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const buffer = await response.arrayBuffer();
          console.log(`     Downloaded ${buffer.byteLength} bytes`);

          // Convert to base64
          const bytes = new Uint8Array(buffer);
          const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
          const base64 = btoa(binary);
          
          // Detect format
          const url = photo.imageUrl.toLowerCase();
          const isPNG = url.includes('.png') || url.includes('png');
          const format = isPNG ? 'PNG' : 'JPEG';
          
          console.log(`     Format: ${format}, Base64 length: ${base64.length}`);

          // Create proper data URI
          const dataURI = `data:image/${format.toLowerCase()};base64,${base64}`;

          // Add to PDF - CRITICAL: Exact positioning
          const imgW = 85;
          const imgH = 60;
          
          console.log(`     Adding at: x=20, y=${yPos}, w=${imgW}, h=${imgH}`);
          
          doc.addImage(dataURI, format, 20, yPos, imgW, imgH, undefined, 'FAST');
          
          console.log(`     ✅ ADDED`);

          yPos += imgH + 2;

          // Caption
          if (photo.caption && photo.caption !== 'Photo') {
            doc.setFontSize(7);
            doc.setTextColor(70, 70, 70);
            doc.text(photo.caption.substring(0, 80), 20, yPos);
            yPos += 5;
          }

          yPos += 3;

        } catch (err) {
          console.error(`     ❌ ERROR: ${err.message}`);
          errorCount++;
          
          // Error placeholder
          doc.setFillColor(250, 220, 220);
          doc.rect(20, yPos, 85, 60, 'F');
          doc.setFontSize(8);
          doc.setTextColor(200, 0, 0);
          doc.text('Image not available', 62, yPos + 30, { align: 'center' });
          
          yPos += 65;
        }
      }

      yPos += 8;
    }

    // Signature
    if (inspectorSignature) {
      if (yPos > pageH - 40) {
        doc.addPage();
        yPos = 20;
      }

      doc.setFontSize(10);
      doc.text('Inspector Signature:', 20, yPos);
      yPos += 8;

      try {
        let sig = inspectorSignature;
        if (!sig.startsWith('data:')) {
          const base64 = sig.includes(',') ? sig.split(',')[1] : sig;
          sig = `data:image/png;base64,${base64}`;
        }
        doc.addImage(sig, 'PNG', 20, yPos, 50, 20);
        console.log('✅ Signature added');
      } catch (e) {
        console.error('Signature error:', e);
      }
    }

    const pdfData = doc.output('arraybuffer');

    console.log(`\n✅ COMPLETE: ${photoCount} photos, ${errorCount} errors`);
    console.log(`📄 PDF: ${(pdfData.byteLength / 1024).toFixed(1)}KB, ${doc.getNumberOfPages()} pages`);

    return new Response(pdfData, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="inspection.pdf"'
      }
    });

  } catch (error) {
    console.error('💥 FATAL:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});