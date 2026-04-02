import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { pdfUrl, contextData } = await req.json();

    console.log('📄 Analyzing PDF form from URL:', pdfUrl);

    const prompt = `Analyze this form and identify ALL fillable fields. For each field provide: field name, type (text/date/checkbox/signature), and suggested value.

CONTEXT DATA TO USE FOR AUTO-FILL:
${JSON.stringify(contextData, null, 2)}

INSTRUCTIONS:
- Use today's date (${contextData.today_date}) for any date fields unless specified otherwise
- For "Project Address" or "Property Address" fields, use CUSTOMER address if available
- For "Applicant", "Company Name", "Contractor", "Business Name" fields, use COMPANY name
- For "Applicant Address", "Company Address", "Contractor Address" fields, use COMPANY full address
- For "Contractor City", use COMPANY city. For "Contractor State", use COMPANY state. For "Contractor Zip", use COMPANY zip
- For "Phone", "Contact Phone", "Contractor Phone" fields, use COMPANY phone
- For "Email", "Contractor Email" fields, use COMPANY email
- For "Website" fields, use COMPANY website
- For "License Number", "License #" fields, use COMPANY license_number if available
- Auto-fill ALL fields where you have matching data from context

INSURANCE ESTIMATE STANDARDIZATION (OPTIONAL - only if present):
If this document appears to be an insurance estimate or claim document, also extract these fields if present and use these standardized names:
- "Age" or "Age of Material" → Map to "MaterialAge"
- "Depreciation" (amount or percentage) → Map to "DepreciationAmount"
- "Replacement Cost Value" or "RCV" → Map to "ReplacementCostValue"
- "Actual Cash Value" or "ACV" → Map to "ActualCashValue"
- "Net Actual Cash Value Payment" or "Net ACV" → Map to "NetACVPayment"
- "Deductible" → Map to "DeductibleAmount"
- "Claim Number" → Map to "ClaimNumber"
- "Policy Number" → Map to "PolicyNumber"
- "Date of Loss" → Map to "DateOfLoss"
- "Date Inspected" → Map to "DateInspected"
- "Tax" or "Material Sales Tax" → Map to "TaxAmount"
- "Overhead & Profit" or "O&P" → Map to "OverheadProfit"

These insurance fields are OPTIONAL - only include them if they exist in the document. Do not create these fields if they're not present.

Return JSON: {"form_title": "Form Name", "fields": [{"name": "Field Name", "type": "text", "suggested_value": "value"}]}`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      file_urls: [pdfUrl],
      response_json_schema: {
        type: "object",
        properties: {
          form_title: { type: "string" },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string" },
                suggested_value: { type: "string" }
              }
            }
          }
        }
      }
    });

    console.log('✅ Analysis complete:', result.form_title, '-', result.fields.length, 'fields');

    return Response.json(result);

  } catch (error) {
    console.error('❌ Analysis error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});