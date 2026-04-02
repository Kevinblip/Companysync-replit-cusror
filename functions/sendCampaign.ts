import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { campaignId } = await req.json();

    if (!campaignId) {
      return Response.json({ error: 'Campaign ID required' }, { status: 400 });
    }

    // Get campaign
    const campaigns = await base44.entities.Campaign.filter({ id: campaignId });
    const campaign = campaigns[0];

    if (!campaign) {
      return Response.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Update campaign status
    await base44.asServiceRole.entities.Campaign.update(campaignId, {
      status: 'sending'
    });

    // Get target audience
    let audience = [];
    
    if (campaign.target_audience === 'leads' || campaign.target_audience === 'both') {
      const leads = await base44.entities.Lead.list();
      audience = [...audience, ...leads];
    }
    
    if (campaign.target_audience === 'customers' || campaign.target_audience === 'both') {
      const customers = await base44.entities.Customer.list();
      audience = [...audience, ...customers];
    }

    // Apply filters
    const filters = campaign.audience_filters || {};
    
    if (filters.source && filters.source.length > 0) {
      audience = audience.filter(a => filters.source.includes(a.source));
    }
    
    if (filters.status && filters.status.length > 0) {
      audience = audience.filter(a => filters.status.includes(a.status));
    }
    
    if (filters.city) {
      audience = audience.filter(a => a.city?.toLowerCase().includes(filters.city.toLowerCase()));
    }
    
    if (filters.state) {
      audience = audience.filter(a => a.state?.toLowerCase() === filters.state.toLowerCase());
    }
    
    if (filters.zip) {
      audience = audience.filter(a => a.zip?.includes(filters.zip));
    }

    // Get template
    let template = null;
    if (campaign.campaign_type === 'email') {
      const templates = await base44.entities.EmailTemplate.filter({ id: campaign.email_template_id });
      template = templates[0];
    } else if (campaign.campaign_type === 'sms') {
      const templates = await base44.entities.SMSTemplate.filter({ id: campaign.sms_template_id });
      template = templates[0];
    }

    if (!template) {
      return Response.json({ error: 'Template not found' }, { status: 404 });
    }

    let sentCount = 0;
    let deliveredCount = 0;

    // Send to each recipient
    for (const recipient of audience) {
      try {
        if (campaign.campaign_type === 'email' && recipient.email) {
          // Replace placeholders
          let subject = template.subject || '';
          let body = template.body || '';
          
          subject = subject.replace(/\{name\}/g, recipient.name || 'Valued Customer');
          subject = subject.replace(/\{address\}/g, [recipient.street, recipient.city, recipient.state, recipient.zip].filter(Boolean).join(', '));
          
          body = body.replace(/\{name\}/g, recipient.name || 'Valued Customer');
          body = body.replace(/\{address\}/g, [recipient.street, recipient.city, recipient.state, recipient.zip].filter(Boolean).join(', '));
          body = body.replace(/\[PHONE\]/g, campaign.company_phone || '');

          // Send via Unified Email System
          await base44.functions.invoke('sendUnifiedEmail', {
              to: recipient.email,
              subject: subject,
              html: body, // Assuming body is HTML from template, or at least text that unified handles
              companyId: campaign.company_id,
              contactName: recipient.name,
              messageType: 'campaign_email',
              skipLogging: false, // Unified will log it
              skipNotification: true // Don't spam notifications for campaigns
          });

          sentCount++;
          deliveredCount++;

        } else if (campaign.campaign_type === 'sms' && (recipient.phone || recipient.phone_2)) {
          const phone = recipient.phone || recipient.phone_2;
          let message = template.message || '';
          
          message = message.replace(/\{name\}/g, recipient.name || 'Customer');
          message = message.replace(/\{address\}/g, [recipient.street, recipient.city].filter(Boolean).join(', '));

          await base44.functions.invoke('sendSMS', {
            to: phone,
            message: message
          });

          sentCount++;
          deliveredCount++;

          // Log communication
          await base44.asServiceRole.entities.Communication.create({
            company_id: campaign.company_id,
            contact_name: recipient.name,
            contact_phone: phone,
            communication_type: 'sms',
            direction: 'outbound',
            message: message,
            status: 'sent'
          });
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`Failed to send to ${recipient.name}:`, error);
      }
    }

    // Update campaign with results
    await base44.asServiceRole.entities.Campaign.update(campaignId, {
      status: 'completed',
      sent_count: sentCount,
      delivered_count: deliveredCount
    });

    return Response.json({
      success: true,
      sent: sentCount,
      delivered: deliveredCount,
      total: audience.length
    });

  } catch (error) {
    console.error('Error sending campaign:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});