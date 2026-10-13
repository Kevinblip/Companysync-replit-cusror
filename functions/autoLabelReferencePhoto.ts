import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { event, data } = await req.json();

    // Only process create events
    if (event?.type !== 'create' || !data?.id) {
      return Response.json({ success: true, message: 'Not a create event' });
    }

    const photoId = data.id;
    const photoUrl = data.photo_url;

    if (!photoUrl) {
      return Response.json({ success: true, message: 'No photo URL' });
    }

    // Extract filename from URL
    const urlParts = photoUrl.split('/');
    const filename = urlParts[urlParts.length - 1];
    
    // Remove file extension and hash
    const cleanName = filename
      .replace(/\.(jpg|jpeg|png|webp)$/i, '')
      .replace(/_[a-z0-9]+$/i, ''); // Remove hash like _rf.abc123

    // Parse damage type from filename
    // Examples: "debris-gutters4" → "debris gutters"
    //           "ac-drain-damage" → "ac drain damage"
    //           "alligatoring_jpeg" → "alligatoring"
    let damageType = cleanName
      .replace(/[-_]/g, ' ')  // Replace hyphens and underscores with spaces
      .replace(/\d+/g, '')     // Remove numbers
      .trim()
      .toLowerCase();

    // If damage type is empty or too short, skip
    if (!damageType || damageType.length < 3) {
      return Response.json({ success: true, message: 'Could not extract damage type' });
    }

    // Capitalize first letter of each word
    damageType = damageType
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    // Generate description based on damage type
    const descriptions = {
      'debris gutters': 'Debris accumulation in gutters causing potential water backup',
      'drain cover displaced': 'AC drain cover dislodged or improperly positioned',
      'ac drain damage': 'Air conditioning drain line damage or blockage',
      'alligatoring': 'Shingle surface cracking resembling alligator skin pattern',
      'missing shingles': 'Shingles completely absent from roof surface',
      'wind crease': 'Horizontal crease marks from wind uplift damage',
      'hail damage': 'Impact marks from hail stones on roofing material',
      'granule loss': 'Loss of protective granules exposing asphalt layer',
      'lifted shingles': 'Shingles raised or curled at edges',
      'flashing damage': 'Damaged or deteriorated metal flashing',
      'soffit damage': 'Deterioration or damage to soffit panels',
      'fascia damage': 'Damage to fascia boards or trim',
      'ridge cap damage': 'Damage to ridge cap shingles along roof peak',
    };

    const descriptionKey = damageType.toLowerCase();
    const description = descriptions[descriptionKey] || 
      `Example showing ${damageType.toLowerCase()} on roofing material`;

    // Update the reference photo with extracted labels
    await base44.asServiceRole.entities.DamageReferencePhoto.update(photoId, {
      damage_type: damageType,
      description: description
    });

    console.log(`✅ Auto-labeled photo ${photoId}: ${damageType}`);

    return Response.json({
      success: true,
      photo_id: photoId,
      damage_type: damageType,
      description: description
    });

  } catch (error) {
    console.error('Auto-label error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});