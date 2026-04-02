import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { fileUrl, templateName, category } = await req.json();

    console.log('📄 Analyzing contract template:', templateName);

    const prompt = `Analyze this contract/form PDF and identify ALL fillable fields across ALL pages.

CRITICAL INSTRUCTIONS:
1. Look at the ACTUAL PDF FORM - examine every label, blank line, signature box, and date field
2. Do NOT make assumptions - only extract what you actually SEE in the document
3. For each field, provide a DESCRIPTIVE label based on what the PDF says (e.g., "Date of Loss" NOT just "Date")
4. If there are multiple "Date" fields, differentiate them (Current Date, Signature Date, Date of Loss, etc.)

For EACH field you find:
1. field_name: code-friendly snake_case (e.g., "customer_name", "date_of_loss", "current_date")
2. field_label: EXACT label from PDF or clear descriptive name (e.g., "Date of Loss", "Current Date", "Signature Date")
3. field_type: text, number, date, email, phone, currency, signature, checkbox, initials
4. filled_by: 
   - "customer" = property owner/client fills this
   - "rep" = company representative fills this
   - "auto" = system auto-fills (current date, company info)
5. required: 
   - true = MUST be filled (name, address, signatures)
   - false = optional (insurance info, phone, email, descriptions)
6. placeholder: helpful example text
7. page_number: which page number (1, 2, 3, etc.)

FIELD CATEGORIZATION RULES:
- Customer identity: name, address, contact → filled_by: "customer", required: true
- Customer signatures → filled_by: "customer", required: true  
- Rep signatures, name, phone → filled_by: "rep", required: true
- Insurance fields (company, policy, claim, adjuster) → filled_by: "rep" or "customer", required: false
- Loss/damage fields → filled_by: "rep" or "customer", required: false
- Current date → filled_by: "auto", required: false
- Signature dates → filled_by: "customer", required: true

IMPORTANT: Examine the document carefully and extract ALL fields, including:
- Signature boxes (look for signature lines)
- Date fields (differentiate: current date, signature date, loss date, appointment date)
- Text fields (name, address, description fields)
- Checkbox/initial fields

Return JSON array of ALL fields you find:`;

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
                field_label: { type: "string" },
                field_type: { type: "string" },
                filled_by: { type: "string" },
                required: { type: "boolean" },
                placeholder: { type: "string" },
                page_number: { type: "number" }
              }
            }
          }
        }
      }
    });

    console.log(`✅ Found ${response.fields?.length || 0} fillable fields`);

    return Response.json({
      success: true,
      fields: response.fields || []
    });

  } catch (error) {
    console.error('💥 Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});