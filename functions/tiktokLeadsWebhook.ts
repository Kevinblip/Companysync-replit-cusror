import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // TikTok webhook verification (GET request)
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const challenge = url.searchParams.get('challenge');
      
      if (challenge) {
        console.log('✅ TikTok webhook verified');
        return new Response(challenge, { status: 200 });
      }
      
      return Response.json({ error: 'Missing challenge' }, { status: 400 });
    }
    
    // Handle POST request (lead data)
    const body = await req.json();
    console.log('📥 TikTok Lead Webhook:', JSON.stringify(body, null, 2));
    
    // TikTok sends lead data in different formats depending on the event
    if (body.event === 'lead.create' || body.type === 'lead') {
      const leadData = body.data || body;
      
      // Extract lead information
      const leadName = leadData.full_name || leadData.name || 'TikTok Lead';
      const leadEmail = leadData.email || '';
      const leadPhone = leadData.phone_number || leadData.phone || '';
      
      console.log(`📋 Creating TikTok lead: ${leadName}`);
      
      // Get company
      const companies = await base44.asServiceRole.entities.Company.list('-created_date', 1);
      const company = companies[0];
      
      // Create lead in CRM
      const newLead = await base44.asServiceRole.entities.Lead.create({
        company_id: company?.id,
        name: leadName,
        email: leadEmail,
        phone: leadPhone,
        source: 'social_media',
        lead_source: 'TikTok Lead Ads',
        status: 'new',
        is_active: true,
        notes: `Lead captured from TikTok ad campaign.\n\nCampaign ID: ${leadData.campaign_id || 'N/A'}\nAd ID: ${leadData.ad_id || 'N/A'}\nCreated: ${leadData.created_time || new Date().toISOString()}`
      });
      
      console.log(`✅ TikTok lead created: ${newLead.id}`);
      
      // Notify admins
      if (company?.id) {
        const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
          company_id: company.id,
          is_administrator: true
        });
        
        for (const staff of staffProfiles) {
          await base44.asServiceRole.entities.Notification.create({
            company_id: company.id,
            user_email: staff.user_email,
            title: '🎵 New TikTok Lead!',
            message: `${leadName} from TikTok Ads - ${leadPhone || leadEmail}`,
            type: 'lead_created',
            related_entity_type: 'Lead',
            related_entity_id: newLead.id,
            link_url: '/leads',
            is_read: false
          });
        }
      }
      
      return Response.json({ success: true, lead_id: newLead.id });
    }
    
    // Unknown event type
    console.log('⚠️ Unknown TikTok webhook event:', body.event || body.type);
    return Response.json({ success: true, message: 'Event received but not processed' });
    
  } catch (error) {
    console.error('❌ TikTok webhook error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});