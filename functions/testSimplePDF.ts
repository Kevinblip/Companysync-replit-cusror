import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { jsPDF } from 'npm:jspdf@2.5.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { testImageUrl } = await req.json();

    console.log('🧪 Testing Simple PDF with Image');
    console.log('📷 Image URL:', testImageUrl);

    const doc = new jsPDF();

    // Add text - this works
    doc.setFontSize(20);
    doc.text('Test PDF with Image', 20, 20);

    // Try to add image - THIS is what's failing
    try {
      console.log('Fetching image...');
      const response = await fetch(testImageUrl);
      console.log('Response status:', response.status);
      
      const arrayBuffer = await response.arrayBuffer();
      console.log('Downloaded bytes:', arrayBuffer.byteLength);

      // METHOD 1: Direct blob
      const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      
      console.log('Base64 length:', base64.length);
      console.log('Base64 sample:', base64.substring(0, 50));

      // Try adding with JPEG format
      doc.addImage(
        `data:image/jpeg;base64,${base64}`,
        'JPEG',
        20,
        40,
        80,
        60
      );

      console.log('✅ Image added to PDF');

    } catch (err) {
      console.error('❌ Image error:', err.message);
      doc.setFontSize(12);
      doc.text('IMAGE FAILED: ' + err.message, 20, 40);
    }

    // Generate PDF
    const pdfBytes = doc.output('arraybuffer');
    console.log('PDF size:', pdfBytes.byteLength);

    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="test.pdf"'
      }
    });

  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});