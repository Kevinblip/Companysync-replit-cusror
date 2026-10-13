import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { templateId, fieldValues } = await req.json();

    if (!templateId || !fieldValues) {
      return Response.json({ 
        success: false, 
        error: 'templateId and fieldValues required' 
      }, { status: 400 });
    }

    // Get template
    const template = await base44.entities.ContractTemplate.get(templateId);
    
    if (!template) {
      return Response.json({ 
        success: false, 
        error: 'Template not found' 
      }, { status: 404 });
    }

    console.log('📝 Filling template:', template.template_name);

    // Fetch original PDF
    const pdfResponse = await fetch(template.original_file_url);
    const pdfBytes = await pdfResponse.arrayBuffer();

    // Load PDF
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Simple text overlay approach (for now)
    // In production, you'd use proper form field detection
    const fieldMappings = template.field_mappings || [];
    
    // Add text overlays for each field
    // This is a simplified version - in production, you'd use AI to detect exact positions
    let yOffset = firstPage.getHeight() - 100;
    
    for (const field of fieldMappings) {
      const value = fieldValues[field.field_name];
      if (value) {
        firstPage.drawText(`${field.field_name}: ${value}`, {
          x: 50,
          y: yOffset,
          size: 10,
          font: font,
          color: rgb(0, 0, 0),
        });
        yOffset -= 20;
      }
    }

    // Save filled PDF
    const filledPdfBytes = await pdfDoc.save();
    const blob = new Blob([filledPdfBytes], { type: 'application/pdf' });
    
    // Upload filled PDF
    const uploadResponse = await base44.integrations.Core.UploadFile({
      file: new File([blob], `filled_${template.template_name}_${Date.now()}.pdf`, { 
        type: 'application/pdf' 
      })
    });

    console.log('✅ Filled PDF created');

    return Response.json({
      success: true,
      pdf_url: uploadResponse.file_url
    });

  } catch (error) {
    console.error('💥 Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});