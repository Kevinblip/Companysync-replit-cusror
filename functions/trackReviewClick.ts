import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const targetUrl = url.searchParams.get('url');
    let safeTarget = 'https://tiny.one/letsreview';
    if (targetUrl) {
      try {
        const parsedTarget = new URL(targetUrl);
        if (parsedTarget.protocol === 'http:' || parsedTarget.protocol === 'https:') {
          safeTarget = parsedTarget.toString();
        }
      } catch (_) {}
    }

    const base44 = createClientFromRequest(req);

    // Update ReviewRequest
    if (id) {
      const requests = await base44.asServiceRole.entities.ReviewRequest.filter({ id });
      const reviewRequest = requests[0];
    
      if (reviewRequest && !reviewRequest.link_clicked) {
        const updatedHistory = (reviewRequest.send_history || []).map((item, idx) => {
          if (idx === reviewRequest.send_history.length - 1 && item.channel === 'email') {
            return { ...item, clicked: true, clicked_at: new Date().toISOString() };
          }
          return item;
        });

        await base44.asServiceRole.entities.ReviewRequest.update(id, {
          link_clicked: true,
          link_clicked_at: new Date().toISOString(),
          send_history: updatedHistory,
          status: 'completed'
        });
      
        console.log(`✅ Link clicked: ${reviewRequest.customer_name}`);
      }
    }

    // Legacy tracked links still land on the actual review destination.
    return Response.redirect(safeTarget, 302);
  } catch (error) {
    console.error('Track click error:', error);
    return Response.redirect('https://tiny.one/letsreview', 302);
  }
});