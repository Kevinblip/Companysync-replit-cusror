import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const body = await req.text();
    const event = JSON.parse(body);
    
    console.log('📧 Resend webhook event:', event.type);
    
    const base44 = createClientFromRequest(req);

    // Extract review request ID from email metadata or tags
    const emailId = event.data?.email_id;
    
    if (event.type === 'email.delivered') {
      // Mark as delivered
      const allRequests = await base44.asServiceRole.entities.ReviewRequest.list('-created_date', 1000);
      
      for (const rr of allRequests) {
        if (rr.send_history && rr.send_history.length > 0) {
          const lastSend = rr.send_history[rr.send_history.length - 1];
          if (lastSend.channel === 'email' && !lastSend.delivered) {
            const updatedHistory = rr.send_history.map((item, idx) => {
              if (idx === rr.send_history.length - 1) {
                return { ...item, delivered: true };
              }
              return item;
            });
            
            await base44.asServiceRole.entities.ReviewRequest.update(rr.id, {
              email_delivered: true,
              send_history: updatedHistory
            });
            
            console.log(`✅ Marked as delivered: ${rr.customer_name}`);
            break;
          }
        }
      }
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error('Resend webhook error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});