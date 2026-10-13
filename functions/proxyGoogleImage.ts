import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { imageUrl } = await req.json();
    
    if (!imageUrl) {
      return Response.json({ error: 'imageUrl is required' }, { status: 400 });
    }

    console.log('📥 Proxying image:', imageUrl);

    // Add API key if not already in URL
    const googleApiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    let finalImageUrl = imageUrl;
    
    if (googleApiKey && !imageUrl.includes('key=')) {
      finalImageUrl = `${imageUrl}&key=${googleApiKey}`;
    }

    console.log('🔑 Fetching with API key...');

    // Fetch the image
    const response = await fetch(finalImageUrl);
    
    if (!response.ok) {
      console.error('❌ Failed to fetch image:', response.status, response.statusText);
      return Response.json({ error: `Failed to fetch image: ${response.status} ${response.statusText}` }, { status: 500 });
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const contentType = response.headers.get('content-type') || 'image/png';
    
    console.log('✅ Image proxied successfully, size:', arrayBuffer.byteLength);

    return Response.json({ 
      imageData: `data:${contentType};base64,${base64}`,
      contentType,
      size: arrayBuffer.byteLength
    });
  } catch (error) {
    console.error('❌ Proxy error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});