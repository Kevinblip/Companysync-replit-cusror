import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { action, avatarId, script, voiceId, title, videoId } = body;
    const apiKey = Deno.env.get('HEYGEN_API_KEY');

    if (!apiKey) {
      return Response.json({ error: 'HeyGen API key not configured' }, { status: 500 });
    }

    console.log('HeyGen API call - Action:', action);

    // List available avatars
    if (action === 'list_avatars') {
      console.log('Fetching avatars with API key:', apiKey ? 'Key present' : 'Key missing');
      
      const response = await fetch('https://api.heygen.com/v2/avatars', {
        method: 'GET',
        headers: {
          'X-Api-Key': apiKey,
        },
      });

      console.log('HeyGen avatars response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('HeyGen avatars error:', response.status, errorText);
        return Response.json({ 
          error: `HeyGen API returned ${response.status}. This usually means the API key is invalid or expired. Please check your HEYGEN_API_KEY secret.`,
          details: errorText 
        }, { status: 400 });
      }

      const data = await response.json();
      console.log('Avatars fetched successfully:', data?.data?.avatars?.length || 0, 'avatars');
      return Response.json(data);
    }

    // List available voices
    if (action === 'list_voices') {
      console.log('Fetching voices with API key:', apiKey ? 'Key present' : 'Key missing');
      
      const response = await fetch('https://api.heygen.com/v2/voices', {
        method: 'GET',
        headers: {
          'X-Api-Key': apiKey,
        },
      });

      console.log('HeyGen voices response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('HeyGen voices error:', response.status, errorText);
        return Response.json({ 
          error: `HeyGen API returned ${response.status}. This usually means the API key is invalid or expired. Please check your HEYGEN_API_KEY secret.`,
          details: errorText 
        }, { status: 400 });
      }

      const data = await response.json();
      console.log('Voices fetched successfully:', data?.data?.voices?.length || 0, 'voices');
      return Response.json(data);
    }

    // Generate video
    if (action === 'generate_video') {
      const response = await fetch('https://api.heygen.com/v2/video/generate', {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          video_inputs: [{
            character: {
              type: 'avatar',
              avatar_id: avatarId,
              avatar_style: 'normal'
            },
            voice: {
              type: 'text',
              input_text: script,
              voice_id: voiceId
            }
          }],
          dimension: {
            width: 1920,
            height: 1080
          },
          aspect_ratio: '16:9',
          test: false,
          title: title || 'CRM Training Video'
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('HeyGen video generation error:', response.status, errorText);
        return Response.json({ error: `HeyGen API error: ${response.status} - ${errorText}` }, { status: response.status });
      }

      const data = await response.json();
      console.log('Video generation started:', data);
      return Response.json(data);
    }

    // Check video status
    if (action === 'check_status') {
      const response = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
        method: 'GET',
        headers: {
          'X-Api-Key': apiKey,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('HeyGen status check error:', response.status, errorText);
        return Response.json({ error: `HeyGen API error: ${response.status} - ${errorText}` }, { status: response.status });
      }

      const data = await response.json();
      return Response.json(data);
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('HeyGen API error:', error);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});