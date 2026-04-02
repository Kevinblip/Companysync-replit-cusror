import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `Search the internet for severe weather events, storms, hail, wind damage, and tornado reports in Ohio over the last 2 weeks (January 2025). 
      
      I need to know:
      - What types of storms occurred (hail, wind, tornado, thunderstorms)
      - Which cities/counties were affected
      - Dates of the storms
      - Severity/damage reports
      - Any specific details about Northeast Ohio (Cleveland, Akron, Canton area)
      
      Please provide detailed information with dates and locations.`,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          storms_found: { type: "boolean" },
          summary: { type: "string" },
          events: {
            type: "array",
            items: {
              type: "object",
              properties: {
                date: { type: "string" },
                location: { type: "string" },
                event_type: { type: "string" },
                severity: { type: "string" },
                details: { type: "string" }
              }
            }
          }
        }
      }
    });

    return Response.json(response);

  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});