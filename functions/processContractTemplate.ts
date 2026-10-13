import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { fileUrl, templateName, category } = await req.json();

    if (!fileUrl) {
      return Response.json({ success: false, error: 'fileUrl required' }, { status: 400 });
    }

    console.log('📄 Processing contract template:', templateName);

    // Use AI to analyze the document and identify fillable fields
    const prompt = `You are analyzing a contract/form document to identify all fillable fields.

Document: ${templateName}
Category: ${category}

Identify EVERY field that needs to be filled by a customer or user, including:
- Customer name, email, phone, address
- Property address
- Date fields
- Signature fields  
- Checkboxes
- Any blank lines or spaces for filling
- Contract terms (start date, end date, price, etc.)

For each field, provide:
1. field_name: Clear descriptive name (e.g., "customer_name", "property_address", "start_date")
2. field_type: "text", "date", "signature", "checkbox", "number", "email", "phone", "address"
3. required: true/false
4. default_value: suggested default if any

Return JSON:
{
  "fields": [
    {
      "field_name": "customer_name",
      "field_type": "text",
      "required": true,
      "default_value": ""
    }
  ],
  "sample_data": {
    "customer_name": "John Smith",
    "property_address": "123 Main St"
  }
}`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      file_urls: [fileUrl],
      response_json_schema: {
        type: "object",
        properties: {
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field_name: { type: "string" },
                field_type: { type: "string" },
                required: { type: "boolean" },
                default_value: { type: "string" }
              }
            }
          },
          sample_data: {
            type: "object",
            additionalProperties: { type: "string" }
          }
        }
      }
    });

    console.log(`✅ Found ${response.fields?.length || 0} fillable fields`);

    return Response.json({
      success: true,
      fields: response.fields || [],
      sample_data: response.sample_data || {}
    });

  } catch (error) {
    console.error('💥 Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});