import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { videoId } = await req.json();

    if (!videoId) {
      return Response.json({ error: 'Video ID is required' }, { status: 400 });
    }

    // Use service role to fetch video without authentication
    const videos = await base44.asServiceRole.entities.TrainingVideo.filter({ id: videoId });
    
    if (!videos || videos.length === 0) {
      return Response.json({ error: 'Video not found' }, { status: 404 });
    }

    return Response.json({ video: videos[0] });
  } catch (error) {
    console.error('Failed to fetch training video:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});