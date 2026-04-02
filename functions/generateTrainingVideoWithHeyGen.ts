import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { slides, videoTitle } = await req.json();
    
    if (!slides || slides.length === 0) {
      return Response.json({ error: 'No slides provided' }, { status: 400 });
    }

    const apiKey = Deno.env.get('HEYGEN_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'HeyGen API key not configured' }, { status: 500 });
    }

    console.log(`🎬 Starting HeyGen video generation for ${slides.length} slides`);

    // HeyGen v2 API for template-based videos
    // We'll create a video with image slides and audio overlay
    const videoInputs = [];

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      
      // Each slide becomes a scene in HeyGen
      videoInputs.push({
        type: 'image',
        url: slide.imageUrl,
        duration: slide.audioUrl ? undefined : 5, // Auto duration if audio, else 5 seconds
        audio: slide.audioUrl ? {
          url: slide.audioUrl,
          type: 'audio'
        } : undefined,
        caption: slide.caption || undefined
      });
    }

    // Create video using HeyGen's video generation API
    const response = await fetch('https://api.heygen.com/v2/video/generate', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video_inputs: videoInputs,
        dimension: {
          width: 1920,
          height: 1080
        },
        aspect_ratio: '16:9',
        test: false,
        title: videoTitle || 'Training Video'
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('HeyGen API error:', response.status, errorText);
      return Response.json({ 
        error: `HeyGen API error: ${response.status}`,
        details: errorText 
      }, { status: response.status });
    }

    const data = await response.json();
    const videoId = data.data?.video_id;

    if (!videoId) {
      return Response.json({ 
        error: 'No video ID returned from HeyGen',
        data 
      }, { status: 500 });
    }

    console.log('✅ Video generation started, ID:', videoId);

    // Poll for completion (HeyGen videos take time to render)
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max (5 second intervals)
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      
      console.log(`⏳ Checking video status... (attempt ${attempts + 1}/${maxAttempts})`);
      
      const statusResponse = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
        method: 'GET',
        headers: {
          'X-Api-Key': apiKey,
        },
      });

      if (!statusResponse.ok) {
        console.error('Status check failed:', statusResponse.status);
        attempts++;
        continue;
      }

      const statusData = await statusResponse.json();
      const status = statusData.data?.status;
      const videoUrl = statusData.data?.video_url;

      console.log('Status:', status);

      if (status === 'completed' && videoUrl) {
        console.log('🎉 Video completed:', videoUrl);
        return Response.json({
          success: true,
          video_url: videoUrl,
          video_id: videoId
        });
      }

      if (status === 'failed') {
        console.error('❌ Video generation failed');
        return Response.json({ 
          error: 'Video generation failed', 
          details: statusData 
        }, { status: 500 });
      }

      attempts++;
    }

    // Timeout - but video might still be processing
    return Response.json({
      success: false,
      error: 'Video generation timed out (still processing)',
      video_id: videoId,
      message: 'Your video is still being generated. You can check the status manually or try again in a few minutes.'
    }, { status: 202 });

  } catch (error) {
    console.error('Error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});