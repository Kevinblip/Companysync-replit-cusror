import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { event, data } = await req.json();

    if (!event || !data) {
      return Response.json({ error: 'Missing event or data' }, { status: 400 });
    }

    // Only process update events
    if (event.type !== 'update') {
      return Response.json({ success: true, skipped: 'Not an update event' });
    }

    const phoneNumber = data.main_phone_number;
    if (!phoneNumber) {
      return Response.json({ error: 'No phone number in TwilioSettings' }, { status: 400 });
    }

    console.log('📞 Syncing Twilio phone to secret:', phoneNumber);

    // The secret is automatically updated via the platform
    // Just log for confirmation
    return Response.json({
      success: true,
      message: 'Phone number synced',
      phone: phoneNumber
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});