import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Verify webhook (Facebook sends GET request for verification)
    if (req.method === 'GET') {
      const url = new URLSearchParams(new URL(req.url).search);
      const mode = url.get('hub.mode');
      const token = url.get('hub.verify_token');
      const challenge = url.get('hub.challenge');
      
      // Set this verify token in your Facebook app webhook settings
      const VERIFY_TOKEN = Deno.env.get('FACEBOOK_VERIFY_TOKEN') || 'yicn_roofing_leads_2025';
      
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook verified');
        return new Response(challenge, { status: 200 });
      }
      
      return Response.json({ error: 'Verification failed' }, { status: 403 });
    }
    
    // Handle POST request (actual lead data)
    const body = await req.json();
    console.log('📥 Facebook Lead Webhook:', JSON.stringify(body, null, 2));
    
    // Parse Facebook lead format
    if (body.entry && body.entry.length > 0) {
      for (const entry of body.entry) {
        if (entry.changes && entry.changes.length > 0) {
          for (const change of entry.changes) {
            if (change.value && change.value.leadgen_id) {
              const leadData = change.value;
              
              // Extract lead info from Facebook format
              const fieldData = {};
              if (leadData.field_data) {
                for (const field of leadData.field_data) {
                  fieldData[field.name] = field.values[0];
                }
              }
              
              // Map to CRM lead format
              const leadName = fieldData.full_name || fieldData.first_name || 'Facebook Lead';
              const leadEmail = fieldData.email || '';
              const leadPhone = fieldData.phone_number || fieldData.phone || '';
              const leadAddress = fieldData.street_address || fieldData.address || '';
              
              console.log(`📋 Creating lead: ${leadName}`);
              
              // Get company (first company in system)
              const companies = await base44.asServiceRole.entities.Company.list('-created_date', 1);
              const company = companies[0];
              
              // Create lead in CRM
              const newLead = await base44.asServiceRole.entities.Lead.create({
                company_id: company?.id,
                name: leadName,
                email: leadEmail,
                phone: leadPhone,
                street: leadAddress,
                source: 'social_media',
                lead_source: 'Facebook Lead Ads',
                status: 'new',
                is_active: true,
                notes: `Lead captured from Facebook ad campaign.\n\nForm ID: ${leadData.form_id}\nAd ID: ${leadData.ad_id}\nCreated Time: ${leadData.created_time}`
              });
              
              console.log(`✅ Lead created: ${newLead.id}`);
              
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
                    title: '🎯 New Facebook Lead!',
                    message: `${leadName} from Facebook Ads - ${leadPhone}`,
                    type: 'lead_created',
                    related_entity_type: 'Lead',
                    related_entity_id: newLead.id,
                    link_url: '/leads',
                    is_read: false
                  });
                }
              }
            }
          }
        }
      }
    }
    
    return Response.json({ success: true });
    
  } catch (error) {
    console.error('❌ Facebook webhook error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});