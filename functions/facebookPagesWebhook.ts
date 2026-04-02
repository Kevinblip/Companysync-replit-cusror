import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Verify webhook (GET request)
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      
      const VERIFY_TOKEN = Deno.env.get('FACEBOOK_PAGES_VERIFY_TOKEN') || 'yicn_pages_2025';
      
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Facebook Pages webhook verified');
        return new Response(challenge, { status: 200 });
      }
      
      return Response.json({ error: 'Verification failed' }, { status: 403 });
    }
    
    // Handle POST request (messages, comments, etc.)
    const body = await req.json();
    console.log('📥 Facebook Pages Webhook:', JSON.stringify(body, null, 2));
    
    if (body.entry && body.entry.length > 0) {
      for (const entry of body.entry) {
        if (entry.messaging) {
          // Handle messages
          for (const event of entry.messaging) {
            if (event.message && !event.message.is_echo) {
              const senderId = event.sender.id;
              const messageText = event.message.text || '';
              
              console.log(`💬 New message from ${senderId}: ${messageText}`);
              
              // Get company
              const companies = await base44.asServiceRole.entities.Company.list('-created_date', 1);
              const company = companies[0];
              
              // Create a message record in CRM
              if (company?.id) {
                await base44.asServiceRole.entities.Message.create({
                  company_id: company.id,
                  sender_id: senderId,
                  sender_name: 'Facebook User',
                  message_text: messageText,
                  platform: 'facebook',
                  status: 'unread',
                  received_at: new Date().toISOString()
                });
                
                // Notify staff
                const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
                  company_id: company.id,
                  is_administrator: true
                });
                
                for (const staff of staffProfiles) {
                  await base44.asServiceRole.entities.Notification.create({
                    company_id: company.id,
                    user_email: staff.user_email,
                    title: '💬 New Facebook Message',
                    message: messageText.substring(0, 100),
                    type: 'message_received',
                    link_url: '/messages',
                    is_read: false
                  });
                }
              }
            }
          }
        }
        
        if (entry.changes) {
          // Handle comments
          for (const change of entry.changes) {
            if (change.field === 'feed' && change.value.item === 'comment') {
              const comment = change.value;
              const commentText = comment.message || '';
              const fromName = comment.from?.name || 'Facebook User';
              
              console.log(`💭 New comment from ${fromName}: ${commentText}`);
              
              // Get company
              const companies = await base44.asServiceRole.entities.Company.list('-created_date', 1);
              const company = companies[0];
              
              // Create a task to respond to comment
              if (company?.id) {
                await base44.asServiceRole.entities.Task.create({
                  company_id: company.id,
                  name: `Respond to Facebook comment from ${fromName}`,
                  description: `Comment: "${commentText}"\n\nPost ID: ${comment.post_id}\nComment ID: ${comment.comment_id}`,
                  status: 'not_started',
                  priority: 'medium',
                  source: 'other'
                });
              }
            }
          }
        }
      }
    }
    
    return Response.json({ success: true });
    
  } catch (error) {
    console.error('❌ Facebook Pages webhook error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});