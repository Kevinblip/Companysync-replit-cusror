import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    
    if (!id) {
      return new Response(null, { status: 400 });
    }

    const base44 = createClientFromRequest(req);

    // Update ReviewRequest
    const requests = await base44.asServiceRole.entities.ReviewRequest.filter({ id });
    const reviewRequest = requests[0];
    
    if (reviewRequest && !reviewRequest.email_opened) {
      const updatedHistory = (reviewRequest.send_history || []).map((item, idx) => {
        if (idx === reviewRequest.send_history.length - 1 && item.channel === 'email') {
          return { ...item, opened: true, opened_at: new Date().toISOString() };
        }
        return item;
      });

      await base44.asServiceRole.entities.ReviewRequest.update(id, {
        email_opened: true,
        email_opened_at: new Date().toISOString(),
        send_history: updatedHistory
      });
      
      console.log(`✅ Email opened: ${reviewRequest.customer_name}`);
    }

    // Return 1x1 transparent pixel
    const pixel = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));
    return new Response(pixel, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  } catch (error) {
    console.error('Track email open error:', error);
    const pixel = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));
    return new Response(pixel, { status: 200, headers: { 'Content-Type': 'image/gif' } });
  }
});