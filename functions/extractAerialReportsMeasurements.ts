import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { fileUrls } = await req.json();
    if (!fileUrls || fileUrls.length === 0) {
      return Response.json({ error: 'No file URLs provided' }, { status: 400 });
    }

    // First, detect document type
    const docTypeResponse = await base44.integrations.Core.InvokeLLM({
      prompt: `Analyze this document and determine if it's an Aerial Report for siding measurements.

**Aerial Reports Siding PDFs contain:**
- Wall area in square feet or squares (1 SQ = 100 sq ft)
- Wall top and wall bottom trim measurements (LF)
- Inside corners (LF)
- Outside corners (LF)
- Sometimes gutter/downspout info

Return JSON with whether this is an Aerial Report and confidence level.`,
      file_urls: fileUrls,
      response_json_schema: {
        type: "object",
        properties: {
          is_aerial_report: { type: "boolean" },
          confidence: { type: "number", description: "0-100" },
          report_type: { type: "string", enum: ["aerial_siding", "other"] }
        }
      }
    });

    if (!docTypeResponse.is_aerial_report) {
      return Response.json({ 
        error: 'Not an Aerial Report for siding', 
        is_aerial_report: false 
      }, { status: 400 });
    }

    // Extract wall measurements from Aerial Report
    const measurementsResponse = await base44.integrations.Core.InvokeLLM({
      prompt: `Extract ALL siding wall measurements from this Aerial Report.

**CRITICAL: Extract EXACT wall measurements:**
- Total wall area (SQ - squares, or square feet)
- Wall top trim (LF - linear feet)
- Wall bottom trim (LF - linear feet)
- Inside corners (LF)
- Outside corners (LF)
- Gutter length if present (LF)
- Number of downspouts if present (EA)
- Customer info if available

**Return JSON with these EXACT field names:**
- wall_area_sq (in squares, 1 SQ = 100 sq ft)
- wall_area_sqft (total square feet)
- wall_top_lf (top trim in linear feet)
- wall_bottom_lf (bottom trim in linear feet)
- inside_corners_lf (inside corner trim)
- outside_corners_lf (outside corner trim)
- gutter_lf (gutter length, 0 if not present)
- downspout_count (number of downspouts, 0 if not present)
- customer_info (name, address, claim_number if available)

Be very careful to convert measurements to correct units:
- If measurements are in feet, use as-is for LF
- If measurements are in inches, convert: inches ÷ 12 = LF
- If wall area is in square feet, divide by 100 to get squares`,
      file_urls: fileUrls,
      response_json_schema: {
        type: "object",
        properties: {
          wall_area_sq: { type: "number", description: "Wall area in squares" },
          wall_area_sqft: { type: "number", description: "Wall area in square feet" },
          wall_top_lf: { type: "number", description: "Top trim length in LF" },
          wall_bottom_lf: { type: "number", description: "Bottom trim length in LF" },
          inside_corners_lf: { type: "number", description: "Inside corner length in LF" },
          outside_corners_lf: { type: "number", description: "Outside corner length in LF" },
          gutter_lf: { type: "number", description: "Gutter length in LF" },
          downspout_count: { type: "number", description: "Number of downspouts" },
          customer_info: {
            type: "object",
            properties: {
              customer_name: { type: "string" },
              property_address: { type: "string" },
              claim_number: { type: "string" }
            }
          }
        }
      }
    });

    console.log('📏 Extracted measurements:', measurementsResponse);

    // Validate that we got meaningful measurements
    if (!measurementsResponse.wall_area_sq && !measurementsResponse.wall_area_sqft) {
      return Response.json({ 
        error: 'Could not extract wall area from Aerial Report',
        measurements: measurementsResponse
      }, { status: 400 });
    }

    return Response.json({
      success: true,
      ...measurementsResponse,
      document_type: 'aerial_siding'
    });

  } catch (error) {
    console.error('Extraction error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});