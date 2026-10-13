import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Google My Business webhook for new reviews
    const body = await req.json();
    console.log('📥 Google My Business Webhook:', JSON.stringify(body, null, 2));
    
    // Google sends review data in this format
    if (body.review) {
      const review = body.review;
      const reviewerName = review.reviewer?.displayName || 'Anonymous';
      const rating = review.starRating || 0;
      const comment = review.comment || '';
      
      console.log(`⭐ New review: ${rating} stars from ${reviewerName}`);
      
      // Get company
      const companies = await base44.asServiceRole.entities.Company.list('-created_date', 1);
      const company = companies[0];
      
      // Create a task to respond to the review
      if (company?.id) {
        await base44.asServiceRole.entities.Task.create({
          company_id: company.id,
          name: `Respond to ${rating}⭐ Google Review`,
          description: `New review from ${reviewerName}:\n\n"${comment}"\n\nPlease respond to this review on Google My Business.`,
          status: 'not_started',
          priority: rating <= 3 ? 'high' : 'medium',
          source: 'other',
          notes: `Review ID: ${review.reviewId}\nLocation: ${body.location?.name || 'N/A'}`
        });
        
        // Notify admins about low ratings
        if (rating <= 3) {
          const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
            company_id: company.id,
            is_administrator: true
          });
          
          for (const staff of staffProfiles) {
            await base44.asServiceRole.entities.Notification.create({
              company_id: company.id,
              user_email: staff.user_email,
              title: '⚠️ Low Google Review Alert',
              message: `${rating}⭐ review from ${reviewerName} - needs immediate response`,
              type: 'task_assigned',
              link_url: '/tasks',
              is_read: false
            });
          }
        }
      }
      
      return Response.json({ success: true });
    }
    
    return Response.json({ success: true, message: 'Webhook received' });
    
  } catch (error) {
    console.error('❌ Google My Business webhook error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});