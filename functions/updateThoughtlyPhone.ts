import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const companyId = body.company_id || body.companyId;
    let phone = body.phone || body.thoughtly_phone || body.number;

    if (!companyId || !phone) {
      return Response.json({ error: 'company_id and phone are required' }, { status: 400 });
    }

    // Normalize US phone to E.164 if 10/11 digits
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length === 10) phone = `+1${digits}`;
    else if (digits.length === 11 && digits.startsWith('1')) phone = `+${digits}`;
    else if (!phone.startsWith('+')) phone = `+${digits}`; // fallback: prefix +

    const rows = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: companyId }, "-updated_date", 100);

    let record;
    if (rows && rows.length > 0) {
      // Update most recent record
      record = rows[0];
      record = await base44.asServiceRole.entities.TwilioSettings.update(record.id, {
        main_phone_number: phone,
      });
    } else {
      record = await base44.asServiceRole.entities.TwilioSettings.create({
        company_id: companyId,
        main_phone_number: phone,
      });
    }

    return Response.json({ success: true, twilio_settings: record });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});