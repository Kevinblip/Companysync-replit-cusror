import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { fileUrl, customerId, customerName, file_size, file_type } = body;
    let { companyId } = body;

    console.log('📥 Received JSON payload:', body);

    if (!fileUrl) {
      return Response.json({ error: 'No file URL provided' }, { status: 400 });
    }
    if (!customerId) {
      return Response.json({ error: 'Customer ID is required' }, { status: 400 });
    }

    // Fallback: if companyId is missing, try to get it from the customer
    if (!companyId) {
      try {
        const customer = await base44.asServiceRole.entities.Customer.read(customerId);
        if (customer && customer.company_id) {
          companyId = customer.company_id;
        }
      } catch (err) {
        console.error('Failed to fetch customer for companyId:', err);
      }
    }

    console.log('📸 Processing check payment for customer:', customerName);

    // 2. Use AI to extract payment details from the check
    console.log('🤖 Analyzing check with AI...');
  const todayStr = new Date().toISOString().split('T')[0];
    const llmResponse = await base44.integrations.Core.InvokeLLM({
      prompt: `You are analyzing a check image. Extract the following details and return them as a JSON object:

- "amount": The dollar amount of the check (as a number, without $ sign or commas)
- "check_number": The check number (as a string)
- "check_date": The date on the check in YYYY-MM-DD format
- "payer_name": The name of the person/company who wrote the check
- "memo": Any memo or notes written on the check

CRITICAL DATE EXTRACTION RULES:
1. Today's date is ${todayStr}
2. Extract the HANDWRITTEN/FILLED-IN date on the check, NOT pre-printed template dates
3. If you see multiple dates, choose the one that's handwritten or most recently filled in
4. NEVER return a date in the future - if extracted date > today, use today instead
5. If the date looks like a template (e.g., "4/4" without context) or is ambiguous, default to today
6. Prefer dates within the last 7 days over older dates
7. Always return "check_date" in YYYY-MM-DD format

If any field is not clearly visible or cannot be determined, use null for that field.

Be accurate with the amount - look for the written amount and the numerical amount, they should match.`,
file_urls: [fileUrl],
      response_json_schema: {
        type: "object",
        properties: {
          amount: { type: "number", nullable: true },
          check_number: { type: "string", nullable: true },
          check_date: { type: "string", nullable: true },
          payer_name: { type: "string", nullable: true },
          memo: { type: "string", nullable: true }
        }
      }
    });

    const { amount, check_number, check_date, payer_name, memo } = llmResponse;

    console.log('✅ AI extraction complete:', llmResponse);

    // Normalize and sanitize the payment date
    const today = new Date();
    let finalPaymentDate = todayStr; // default to today
    if (typeof check_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(check_date)) {
      const parsed = new Date(check_date + 'T00:00:00Z');
      if (!isNaN(parsed.getTime())) {
        // If date is in the future, use today instead
        if (parsed > today) {
          console.log('⚠️ AI extracted future date, using today instead:', check_date);
          finalPaymentDate = todayStr;
        } else {
          // Check if date is within last 180 days
          const diffDays = Math.abs((today.getTime() - parsed.getTime()) / 86400000);
          if (diffDays <= 180) {
            finalPaymentDate = check_date; // keep extracted date as-is
          } else {
            // If the date is too old, prefer the current year with same month/day (fallback to today if invalid)
            const [y, m, d] = check_date.split('-').map(Number);
            const candidate = new Date(today.getFullYear(), (m || 1) - 1, d || 1);
            if (!isNaN(candidate.getTime()) && candidate <= today) {
              finalPaymentDate = candidate.toISOString().split('T')[0];
            } else {
              finalPaymentDate = todayStr;
            }
          }
        }
      }
    }

    // 3. Generate payment number
    const existingPayments = await base44.asServiceRole.entities.Payment.list('-created_date', 1);
    let nextNumber = 1;
    if (existingPayments.length > 0) {
      const lastPayment = existingPayments[0];
      if (lastPayment.payment_number) {
        const match = lastPayment.payment_number.match(/\d+$/);
        if (match) {
          nextNumber = parseInt(match[0]) + 1;
        }
      }
    }
    const paymentNumber = `PMT-${String(nextNumber).padStart(5, '0')}`;

    // 4. Create a Document record for the check image FIRST
    const newDocument = await base44.asServiceRole.entities.Document.create({
      company_id: companyId,
      document_name: `Check Payment ${check_number || paymentNumber}`,
      file_url: fileUrl,
      file_size: file_size || 0,
      file_type: file_type || 'image/jpeg',
      category: 'Check',
      related_entity_type: 'Customer', // Keep as Customer for visibility in file lists
      related_entity_id: customerId,
      description: `Check payment: $${amount || '0.00'} - ${payer_name || 'Unknown payer'}`,
      uploaded_by: user.email,
    });

    console.log('✅ Document record created:', newDocument.id);

    // 5. Create a Payment record linked to the document
    // NOTE: We don't try to link invoice here because AI check extraction doesn't reliably get invoice numbers.
    // The user will likely use the "Sync/Recalculate Invoices" button later or we could try to find open invoices.
    // For now, let's keep it simple as just recording the payment.
    
    // Try to find an open invoice for this customer with matching amount? 
    // Maybe too risky for automation. Let's just create it.
    
    const newPayment = await base44.asServiceRole.entities.Payment.create({
      company_id: companyId,
      customer_id: customerId,
      customer_name: customerName,
      payment_number: paymentNumber,
      amount: amount || 0,
      payment_method: 'check',
      payment_date: finalPaymentDate,
      reference_number: check_number || 'N/A',
      notes: memo ? `Payer: ${payer_name || 'N/A'}\nMemo: ${memo}` : `Payer: ${payer_name || 'N/A'}`,
      status: 'received',
      file_url: fileUrl,
      document_id: newDocument.id
    });

    console.log('✅ Payment record created:', newPayment.id);

    console.log('✅ Document record created:', newDocument.id);

    return Response.json({
      success: true,
      payment: newPayment,
      document: newDocument,
      extracted_data: {
        amount,
        check_number,
        check_date,
        payer_name,
        memo
      }
    });

  } catch (error) {
    console.error('❌ Error processing check payment:', error);
    return Response.json({
      error: error.message,
      success: false,
      details: error.toString(),
    }, { status: 500 });
  }
});