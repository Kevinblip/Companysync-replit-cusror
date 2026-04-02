import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { PDFDocument, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { pdfUrl, fields, signatureData } = await req.json();

    console.log('📄 Filling PDF from URL:', pdfUrl);

    // Download the original PDF
    const pdfResponse = await fetch(pdfUrl);
    if (!pdfResponse.ok) {
      throw new Error(`Failed to download PDF: ${pdfResponse.status} ${pdfResponse.statusText}`);
    }
    
    const pdfBytes = await pdfResponse.arrayBuffer();
    console.log('✅ PDF downloaded, size:', pdfBytes.byteLength, 'bytes');

    // Load the PDF with error handling
    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      console.log('✅ PDF loaded successfully');
    } catch (loadError) {
      console.error('❌ Failed to load PDF:', loadError);
      throw new Error(`PDF is corrupted or encrypted: ${loadError.message}`);
    }
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    // Embed font
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 10;

    // Fill in the fields
    console.log('📝 Filling', Object.keys(fields).length, 'fields');
    for (const [fieldName, value] of Object.entries(fields)) {
      if (!value || value === '' || value === 'false' || value === false) continue;
      console.log('  •', fieldName, '=', String(value).substring(0, 50));

      // Simple positioning logic based on field name patterns
      let x = 100;
      let y = height - 150;

      // Try to position based on field name keywords
      if (fieldName.toLowerCase().includes('permit number')) {
        x = 500; y = height - 85;
      } else if (fieldName.toLowerCase().includes('date of application')) {
        x = 500; y = height - 110;
      } else if (fieldName.toLowerCase().includes('project type')) {
        x = 150; y = height - 175;
      } else if (fieldName.toLowerCase().includes('project address')) {
        x = 150; y = height - 200;
      } else if (fieldName.toLowerCase().includes('twp/village/city')) {
        x = 150; y = height - 225;
      } else if (fieldName.toLowerCase().includes('project value')) {
        x = 150; y = height - 250;
      } else if (fieldName.toLowerCase().includes('parcel number')) {
        x = 500; y = height - 250;
      } else if (fieldName.toLowerCase().includes('owner') && fieldName.toLowerCase().includes('name')) {
        x = 100; y = height - 320;
      } else if (fieldName.toLowerCase().includes('owner') && fieldName.toLowerCase().includes('mailing address')) {
        x = 100; y = height - 345;
      } else if (fieldName.toLowerCase().includes('owner') && fieldName.toLowerCase().includes('city')) {
        x = 100; y = height - 370;
      } else if (fieldName.toLowerCase().includes('owner') && fieldName.toLowerCase().includes('phone')) {
        x = 100; y = height - 395;
      } else if (fieldName.toLowerCase().includes('owner') && fieldName.toLowerCase().includes('email')) {
        x = 100; y = height - 420;
      } else if (fieldName.toLowerCase().includes('general contractor') && fieldName.toLowerCase().includes('name')) {
        x = 100; y = height - 480;
      } else if (fieldName.toLowerCase().includes('general contractor') && fieldName.toLowerCase().includes('address')) {
        x = 100; y = height - 505;
      } else if (fieldName.toLowerCase().includes('general contractor') && fieldName.toLowerCase().includes('city')) {
        x = 100; y = height - 530;
      } else if (fieldName.toLowerCase().includes('general contractor') && fieldName.toLowerCase().includes('phone')) {
        x = 100; y = height - 555;
      } else if (fieldName.toLowerCase().includes('general contractor') && fieldName.toLowerCase().includes('email')) {
        x = 100; y = height - 580;
      } else if (fieldName.toLowerCase().includes('print name')) {
        x = 100; y = 150;
      } else if (fieldName.toLowerCase().includes('date') && !fieldName.toLowerCase().includes('application')) {
        x = 500; y = 150;
      }

      // Handle checkbox fields
      if (value === true || value === 'true') {
        firstPage.drawText('X', {
          x: x - 15,
          y: y - 3,
          size: fontSize,
          font: font,
          color: rgb(0, 0, 0),
        });
      } else {
        // Draw text for regular fields
        const text = String(value).substring(0, 100); // Limit length
        firstPage.drawText(text, {
          x,
          y,
          size: fontSize,
          font: font,
          color: rgb(0, 0, 0),
        });
      }
    }

    // Add signature if provided
    if (signatureData) {
      try {
        // Extract base64 image data
        const base64Data = signatureData.split(',')[1];
        const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        
        const signatureImage = await pdfDoc.embedPng(imageBytes);
        const signatureDims = signatureImage.scale(0.2);
        
        firstPage.drawImage(signatureImage, {
          x: 300,
          y: 130,
          width: signatureDims.width,
          height: signatureDims.height,
        });
      } catch (error) {
        console.error('Failed to add signature:', error);
      }
    }

    // Save the filled PDF
    const filledPdfBytes = await pdfDoc.save();
    console.log('✅ PDF saved, size:', filledPdfBytes.byteLength, 'bytes');

    // Return as downloadable PDF
    return new Response(filledPdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename=filled_permit.pdf'
      }
    });

  } catch (error) {
    console.error('Error filling PDF:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});