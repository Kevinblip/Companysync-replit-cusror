import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Compass bearing from point A → point B, degrees [0, 360).
 * Used to compute the road-to-house heading when the client
 * hasn't already provided customHeadings.
 */
function computeBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { latitude, longitude, address, panoId: knownPanoId } = await req.json();
    if (!latitude || !longitude) {
      return Response.json({ error: 'Latitude and longitude are required' }, { status: 400 });
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, { status: 500 });
    }

    let resolvedPanoId: string | undefined = knownPanoId;
    let frontHeading = 0;

    // Resolve the nearest panorama and derive exactly one road-to-house view.
    // Rotating one panorama does not create left/right/rear elevation evidence.
    {
      try {
        const metaUrl = resolvedPanoId
          ? `https://maps.googleapis.com/maps/api/streetview/metadata?pano=${resolvedPanoId}&key=${apiKey}`
          : `https://maps.googleapis.com/maps/api/streetview/metadata?location=${latitude},${longitude}&radius=100&source=outdoor&key=${apiKey}`;
        const metaResp = await fetch(metaUrl);
        const meta = await metaResp.json();

        if (meta.status === 'OK') {
          resolvedPanoId = meta.pano_id;

          frontHeading = (meta.location?.lat != null && meta.location?.lng != null)
            ? computeBearing(meta.location.lat, meta.location.lng, latitude, longitude)
            : 0;
          console.log(`[getStreetViewImages] Computed house-facing bearing=${frontHeading.toFixed(1)}° (pano→house)`);
        } else {
          const staticApiEnabled = meta.status !== 'REQUEST_DENIED';
          console.log(`[getStreetViewImages] No street view coverage (${meta.status})`);
          return Response.json({
            success: true,
            address: address || `${latitude},${longitude}`,
            images: [{ direction: 'Street-facing reference', heading: 0, available: false, source_type: 'street_view', verified_elevation: false }],
            availableCount: 0,
            staticApiEnabled,
            message: meta.status === 'REQUEST_DENIED'
              ? 'Street View Static API not enabled. Enable it in Google Cloud Console → APIs & Services → Street View Static API.'
              : 'No street view coverage at this location.',
          });
        }
      } catch (e: any) {
        console.error('[getStreetViewImages] Metadata fetch error:', e.message);
        return Response.json({ success: false, error: e.message, images: [], availableCount: 0 });
      }
    }

    const results = [];
    const resolvedDirections = [{ label: 'Front', heading: frontHeading }];
    for (const dir of resolvedDirections) {
      try {
        // Quick availability check for this heading
        const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?pano=${resolvedPanoId}&heading=${dir.heading}&key=${apiKey}`;
        const metaResp = await fetch(metaUrl);
        const meta = await metaResp.json();

        if (meta.status !== 'OK') {
          results.push({ direction: dir.label, heading: dir.heading, available: false });
          continue;
        }

        // Fetch image using panoId + heading for precision
        const imageUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x480&pano=${resolvedPanoId}&heading=${dir.heading}&fov=60&pitch=20&key=${apiKey}`;
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

        const imgFile = new File(
          [imgBlob],
          `streetview_${dir.label.toLowerCase().replace(/\s+/g, '_')}.jpg`,
          { type: 'image/jpeg' },
        );
        const uploadResult = await base44.integrations.Core.UploadFile({ file: imgFile });

        if (uploadResult?.file_url) {
          results.push({
            direction: dir.label,
            heading: dir.heading,
            available: true,
            imageUrl: uploadResult.file_url,
            panoId: resolvedPanoId,
            source_type: 'street_view',
            panorama_id: resolvedPanoId,
            verified_elevation: false,
            evidence_role: 'house_facing_reference',
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
    console.log(`[getStreetViewImages] Complete: ${availableCount}/${results.length} angles available`);

    return Response.json({
      success: true,
      staticApiEnabled: true,
      address: address || `${latitude},${longitude}`,
      images: results,
      availableCount,
      evidencePolicy: 'single_house_facing_panorama',
    });

  } catch (error: any) {
    console.error('getStreetViewImages error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});
