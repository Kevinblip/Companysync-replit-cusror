import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { latitude, longitude, address } = await req.json();
    if (!latitude || !longitude) {
      return Response.json({ error: 'Latitude and longitude are required' }, { status: 400 });
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, { status: 500 });
    }

    const directions = [
      { label: 'North', heading: 0 },
      { label: 'East', heading: 90 },
      { label: 'South', heading: 180 },
      { label: 'West', heading: 270 },
    ];

    const results = [];

    for (const dir of directions) {
      try {
        const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${latitude},${longitude}&heading=${dir.heading}&radius=50&key=${apiKey}`;
        const metaResp = await fetch(metaUrl);
        const meta = await metaResp.json();

        if (meta.status !== 'OK') {
          results.push({ direction: dir.label, heading: dir.heading, available: false });
          continue;
        }

        const imageUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${latitude},${longitude}&heading=${dir.heading}&fov=90&pitch=5&radius=50&key=${apiKey}`;
        const imgResp = await fetch(imageUrl);

        if (!imgResp.ok) {
          results.push({ direction: dir.label, heading: dir.heading, available: false });
          continue;
        }

        const imgBlob = await imgResp.blob();

        if (!imgBlob.type.includes('image') || imgBlob.size < 3000) {
          results.push({ direction: dir.label, heading: dir.heading, available: false });
          continue;
        }

        const imgFile = new File([imgBlob], `streetview_${dir.label.toLowerCase()}.jpg`, { type: 'image/jpeg' });
        const uploadResult = await base44.integrations.Core.UploadFile({ file: imgFile });

        if (uploadResult?.file_url) {
          results.push({
            direction: dir.label,
            heading: dir.heading,
            available: true,
            imageUrl: uploadResult.file_url,
            panoId: meta.pano_id || null
          });
        } else {
          results.push({ direction: dir.label, heading: dir.heading, available: false });
        }
      } catch (dirErr: any) {
        console.error(`Error fetching ${dir.label} view:`, dirErr.message);
        results.push({ direction: dir.label, heading: dir.heading, available: false });
      }
    }

    const availableCount = results.filter(r => r.available).length;

    return Response.json({
      success: true,
      address: address || `${latitude},${longitude}`,
      images: results,
      availableCount
    });

  } catch (error: any) {
    console.error('getStreetViewImages error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});
