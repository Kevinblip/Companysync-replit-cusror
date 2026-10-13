import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { video_url, title, description } = await req.json();
    
    if (!video_url) {
      return Response.json({ error: 'video_url is required' }, { status: 400 });
    }

    // Get YouTube access token from connector
    const accessToken = await base44.asServiceRole.connectors.getAccessToken('youtube');
    
    if (!accessToken) {
      return Response.json({ 
        error: 'YouTube not connected. Please authorize YouTube access first.' 
      }, { status: 401 });
    }

    console.log('Downloading video from:', video_url);
    
    // Download the video file
    const videoResponse = await fetch(video_url);
    if (!videoResponse.ok) {
      throw new Error('Failed to download video: ' + videoResponse.statusText);
    }
    
    const videoBlob = await videoResponse.blob();
    const videoBuffer = await videoBlob.arrayBuffer();
    
    console.log('Video downloaded, size:', videoBuffer.byteLength);

    // Step 1: Initialize upload
    const metadata = {
      snippet: {
        title: title || 'Training Video',
        description: description || 'Training video created with CRM',
        categoryId: '27' // Education category
      },
      status: {
        privacyStatus: 'unlisted' // Can be 'public', 'private', or 'unlisted'
      }
    };

    const initResponse = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/*'
        },
        body: JSON.stringify(metadata)
      }
    );

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      console.error('YouTube init error:', errorText);
      throw new Error('Failed to initialize YouTube upload: ' + errorText);
    }

    const uploadUrl = initResponse.headers.get('location');
    if (!uploadUrl) {
      throw new Error('No upload URL received from YouTube');
    }

    console.log('Upload initialized, uploading video...');

    // Step 2: Upload video
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'video/*'
      },
      body: videoBuffer
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('YouTube upload error:', errorText);
      throw new Error('Failed to upload video to YouTube: ' + errorText);
    }

    const result = await uploadResponse.json();
    const videoId = result.id;
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    console.log('Upload complete! YouTube URL:', youtubeUrl);

    return Response.json({
      success: true,
      youtube_url: youtubeUrl,
      video_id: videoId
    });

  } catch (error) {
    console.error('YouTube upload error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});