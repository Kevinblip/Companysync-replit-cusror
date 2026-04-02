import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';
import Anthropic from 'npm:@anthropic-ai/sdk@0.32.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { fileUrl } = await req.json();

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) {
      return Response.json({ success: false, error: 'Anthropic API key not configured' }, { status: 500 });
    }

    console.log('📄 Fetching PDF from:', fileUrl);

    // Step 1: Download the PDF as base64
    const pdfResponse = await fetch(fileUrl);
    if (!pdfResponse.ok) {
      throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);
    }

    const pdfBuffer = await pdfResponse.arrayBuffer();
    const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBuffer)));

    console.log('✅ PDF downloaded, size:', pdfBase64.length, 'bytes (base64)');

    // Step 2: Send to Claude with PDF as document
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const extractionPrompt = `You are reading a roofing measurement report (GAF QuickMeasure, Roofgraf, EagleView, Hover, etc.).

**EXTRACT THESE EXACT MEASUREMENTS FROM THE DOCUMENT:**

1. **Roof Area** - Look for "Roof Area", "Total Area", or "Squares" (SQ or sq ft)
   - If in sq ft, convert to SQ by dividing by 100
   - Example: 1,279 sq ft = 12.79 SQ

2. **Ridge** - Linear feet of ridge lines

3. **Hip** - Linear feet of hip lines

4. **Valley** - Linear feet of valley lines

5. **Rake** - Linear feet of rake edges (sloped edges)

6. **Eave** - Linear feet of eave edges (level edges)

7. **Step Flashing** - Linear feet of step flashing

8. **Apron Flashing** - Linear feet of apron flashing

9. **Property Address** - Full street address

10. **Roof Pitch** - Predominant pitch (e.g., "11/12", "8/12")

**CRITICAL RULES:**
- Extract EXACT numbers from the report - DO NOT GUESS
- If a measurement is not found, set it to 0
- Return valid JSON only

**JSON FORMAT:**
{
  "roof_area_sq": 12.79,
  "ridge_lf": 59,
  "hip_lf": 6,
  "valley_lf": 0,
  "rake_lf": 160,
  "eave_lf": 139,
  "step_flashing_lf": 78,
  "apron_flashing_lf": 0,
  "property_address": "3714 E 149th St, Cleveland, OH 44120",
  "roof_pitch": "11/12"
}`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64
            }
          },
          {
            type: 'text',
            text: extractionPrompt
          }
        ]
      }]
    });

    console.log('🤖 Claude response:', JSON.stringify(message.content));

    // Extract JSON from response
    const textContent = message.content.find(block => block.type === 'text');
    if (!textContent) {
      throw new Error('No text response from Claude');
    }

    // Parse JSON from response (might be wrapped in markdown code blocks)
    let jsonText = textContent.text.trim();
    const jsonMatch = jsonText.match(/```json\n([\s\S]*?)\n```/) || jsonText.match(/```\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1];
    }

    const result = JSON.parse(jsonText);

    return Response.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('❌ Error reading PDF:', error);
    return Response.json({ 
      success: false, 
      error: error.message,
      details: error.stack
    }, { status: 500 });
  }
});