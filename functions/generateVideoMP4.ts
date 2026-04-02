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

    console.log(`🎬 Creating video with ${slides.length} slides using HeyGen`);

    const heygenApiKey = Deno.env.get('HEYGEN_API_KEY');
    
    if (!heygenApiKey) {
      return Response.json({ error: 'HeyGen API key not configured' }, { status: 500 });
    }

    // Create video using HeyGen API
    const videoData = {
      video_inputs: slides.map((slide, index) => ({
        character: {
          type: "image",
          image_url: slide.imageUrl
        },
        voice: {
          type: "audio",
          audio_url: slide.audioUrl
        },
        duration: 5
      })),
      title: videoTitle || "Training Video",
      dimension: { width: 1280, height: 720 }
    };

    const createResponse = await fetch('https://api.heygen.com/v2/video/generate', {
      method: 'POST',
      headers: {
        'X-Api-Key': heygenApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(videoData)
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('❌ HeyGen error:', errorText);
      return Response.json({ error: 'Failed to create video with HeyGen: ' + errorText }, { status: 500 });
    }

    const createResult = await createResponse.json();
    const videoId = createResult.data?.video_id;

    if (!videoId) {
      return Response.json({ error: 'No video ID returned from HeyGen' }, { status: 500 });
    }

    console.log('⏳ Waiting for video to be ready...');

    // Poll for video completion
    let videoUrl = null;
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max

    while (!videoUrl && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      
      const statusResponse = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
        headers: { 'X-Api-Key': heygenApiKey }
      });

      const statusResult = await statusResponse.json();
      
      if (statusResult.data?.status === 'completed') {
        videoUrl = statusResult.data.video_url;
      } else if (statusResult.data?.status === 'failed') {
        return Response.json({ error: 'Video generation failed' }, { status: 500 });
      }
      
      attempts++;
    }

    if (!videoUrl) {
      return Response.json({ error: 'Video generation timed out' }, { status: 500 });
    }

    console.log('✅ Video ready, downloading...');

    // Download the video
    const videoResponse = await fetch(videoUrl);
    const videoBytes = await videoResponse.arrayBuffer();

    return new Response(videoBytes, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${videoTitle || 'training_video'}.mp4"`,
        'Content-Length': videoBytes.byteLength.toString()
      }
    });

  } catch (error) {
    console.error('❌ Video generation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});