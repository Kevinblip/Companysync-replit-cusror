import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const targetUrl = url.searchParams.get('url');
    
    if (!id || !targetUrl) {
      return Response.redirect('https://google.com', 302);
    }

    const base44 = createClientFromRequest(req);

    // Update ReviewRequest
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

    // Redirect to actual Google review link
    return Response.redirect(targetUrl, 302);
  } catch (error) {
    console.error('Track click error:', error);
    return Response.redirect('https://google.com', 302);
  }
});