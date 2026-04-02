import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { address, currentPitch, imageUrls, currentAnalysis } = await req.json();

    if (!imageUrls || imageUrls.length === 0) {
      return Response.json({ error: 'No image URLs provided' }, { status: 400 });
    }

    const numImages = imageUrls.length;
    const prompt = `You are an expert roofing estimator. You are analyzing ${numImages} street-level elevation photo(s) of the property at: ${address}

Current satellite-derived pitch estimate: ${currentPitch || 'Unknown'}

CRITICAL RULES:
1. Focus ONLY on the roof of the subject property at this address. If any photo shows a neighbor's roof, wall, or structure, ignore it completely — do not include it in any measurement.
2. You are estimating pitch ONLY — do not estimate area, linear feet, or dimensions. Those come from a separate satellite source.
3. Pitch is measured in X/12 format (rise over 12 inches of run). A 4/12 pitch looks nearly flat from the street. A 12/12 pitch is a 45-degree triangle. A 7/12 pitch is a moderately steep residential slope.
4. Use the number of visible stories and the height of the roof triangle above the wall plate to calibrate scale.
5. If a photo is obstructed by trees, a fence, another building, or does not clearly show the subject property's roof, skip it and say so.
6. If you cannot make a confident estimate from the photos, say so — do not guess.

WHAT TO LOOK FOR:
- The angle the roof line makes against the sky or a vertical wall
- How much of the roof is visible above the top of the upper-story windows
- Whether dormer sections or additions have a different pitch than the main roof
- Visible steep sections vs shallow sections on complex roofs

Respond ONLY with valid JSON in this exact format:
{
  "refinedPitch": "X/12",
  "confidence": "high|medium|low",
  "reasoning": "One to two sentences explaining what you saw",
  "skippedPhotos": "Description of any photos that were skipped and why, or empty string",
  "sectionNotes": "Any notes about different pitches on different sections (dormers, additions), or empty string",
  "shouldUpdate": true
}

If you cannot determine pitch at all, use: "refinedPitch": "${currentPitch || 'unknown'}", "confidence": "low", "shouldUpdate": false`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      file_urls: imageUrls,
      response_json_schema: {
        type: 'object',
        properties: {
          refinedPitch: { type: 'string' },
          confidence: { type: 'string' },
          reasoning: { type: 'string' },
          skippedPhotos: { type: 'string' },
          sectionNotes: { type: 'string' },
          shouldUpdate: { type: 'boolean' }
        },
        required: ['refinedPitch', 'confidence', 'reasoning', 'shouldUpdate']
      }
    });

    return Response.json({
      success: true,
      refinedPitch: result.refinedPitch || currentPitch,
      confidence: result.confidence || 'low',
      reasoning: result.reasoning || 'Unable to determine from photos',
      skippedPhotos: result.skippedPhotos || '',
      sectionNotes: result.sectionNotes || '',
      shouldUpdate: result.shouldUpdate !== false,
      previousPitch: currentPitch
    });

  } catch (error: any) {
    console.error('refinePitchFromElevation error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});
