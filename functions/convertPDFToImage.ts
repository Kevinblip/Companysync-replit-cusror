import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { pdfUrl } = await req.json();

    if (!pdfUrl) {
      return Response.json({ error: 'pdfUrl is required' }, { status: 400 });
    }

    // Use Claude's vision API which handles PDFs better by converting them to images
    const prompt = "Convert this PDF page to a high-quality image. Return the image data.";
    
    // Download the PDF
    const pdfResponse = await fetch(pdfUrl);
    const pdfBlob = await pdfResponse.blob();
    
    // Convert to base64
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    // Use Anthropic API directly to get image from PDF
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64
              }
            },
            {
              type: 'text',
              text: 'Describe what you see in this document. Be thorough about all text and form fields.'
            }
          ]
        }]
      })
    });

    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error.message);
    }

    // Return the original URL - Claude can now read it
    return Response.json({ 
      success: true,
      imageUrl: pdfUrl,
      description: result.content[0].text
    });

  } catch (error) {
    console.error('PDF conversion error:', error);
    return Response.json({ 
      error: error.message,
      suggestion: 'Please try uploading the form as a PNG or JPG image instead.'
    }, { status: 500 });
  }
});