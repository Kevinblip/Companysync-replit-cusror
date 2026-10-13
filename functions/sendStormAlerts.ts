import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { stormId, companyId } = await req.json();

    if (!stormId || !companyId) {
      return Response.json({ error: 'Storm ID and Company ID required' }, { status: 400 });
    }

    // Get storm details
    const storms = await base44.asServiceRole.entities.StormEvent.filter({ id: stormId });
    if (!storms || storms.length === 0) {
      return Response.json({ error: 'Storm not found' }, { status: 404 });
    }
    const storm = storms[0];

    // Get company alert settings
    const settings = await base44.asServiceRole.entities.StormAlertSettings.filter({ 
      company_id: companyId 
    });
    
    if (!settings || settings.length === 0) {
      return Response.json({ 
        success: false,
        message: 'No alert settings configured for this company' 
      });
    }

    const alertSettings = settings[0];

    // Check if storm matches severity threshold
    const severityLevels = { all: 0, minor: 1, moderate: 2, severe: 3, extreme: 4 };
    const stormSeverityLevel = severityLevels[storm.severity] || 2;
    const thresholdLevel = severityLevels[alertSettings.alert_severity_threshold] || 2;

    if (stormSeverityLevel < thresholdLevel) {
      return Response.json({ 
        success: false,
        message: 'Storm severity below threshold' 
      });
    }

    // Check if storm affects service areas
    const affectedServiceAreas = (alertSettings.service_areas || []).filter(area => 
      storm.affected_areas?.some(stormArea => 
        stormArea.toLowerCase().includes(area.toLowerCase()) ||
        area.toLowerCase().includes(stormArea.toLowerCase())
      )
    );

    if (affectedServiceAreas.length === 0) {
      return Response.json({ 
        success: false,
        message: 'Storm does not affect monitored service areas' 
      });
    }

    // Check if storm type is monitored
    const monitoredTypes = alertSettings.storm_types_to_monitor || ['hail', 'tornado', 'high_wind'];
    if (!monitoredTypes.includes(storm.event_type)) {
      return Response.json({ 
        success: false,
        message: 'Storm type not monitored' 
      });
    }

    // Prepare alert message
    const alertTitle = `⚠️ Storm Alert: ${storm.title}`;
    const alertMessage = `
A ${storm.severity} ${storm.event_type} has been detected in your service area!

📍 Affected Areas: ${affectedServiceAreas.join(', ')}

Storm Details:
${storm.hail_size_inches ? `🧊 Hail Size: ${storm.hail_size_inches} inches\n` : ''}${storm.wind_speed_mph ? `💨 Wind Speed: ${storm.wind_speed_mph} mph\n` : ''}🕐 Time: ${storm.start_time ? new Date(storm.start_time).toLocaleString() : 'Now'}

This is an excellent opportunity to reach out to property owners in the affected areas!

${alertSettings.auto_generate_leads ? '\n✅ Automatic lead generation has been triggered.' : '\n💡 Go to Storm Tracking to generate leads from this event.'}
`;

    const recipients = alertSettings.alert_recipients || [];
    const emailsSent = [];
    const smsSent = [];

    // Send alerts to each recipient
    for (const recipient of recipients) {
      // Send Email
      if (alertSettings.enable_email_alerts && recipient.notify_email && recipient.email) {
        try {
          await base44.functions.invoke('sendUnifiedEmail', {
            to: recipient.email,
            subject: alertTitle,
            message: alertMessage,
            companyId: companyId,
            contactName: recipient.name,
            skipNotification: true, // Alerts are often bulk, prevent flooding bell notifications
            skipLogging: false
          });
          emailsSent.push(recipient.email);
        } catch (error) {
          console.error(`Failed to send email to ${recipient.email}:`, error);
        }
      }

      // Send SMS
      if (alertSettings.enable_sms_alerts && recipient.notify_sms && recipient.phone) {
        try {
          const smsMessage = `${alertTitle}\n\n${affectedServiceAreas.join(', ')}\n${storm.hail_size_inches ? `Hail: ${storm.hail_size_inches}"` : ''}${storm.wind_speed_mph ? ` Wind: ${storm.wind_speed_mph}mph` : ''}\n\nCheck Storm Tracking for details.`;
          
          await base44.functions.invoke('sendSMS', {
            to: recipient.phone,
            message: smsMessage.substring(0, 160), // SMS limit
            contactName: recipient.name,
            companyId: companyId
          });
          smsSent.push(recipient.phone);
        } catch (error) {
          console.error(`Failed to send SMS to ${recipient.phone}:`, error);
        }
      }
    }

    // Auto-generate leads if enabled
    let leadsGenerated = 0;
    if (alertSettings.auto_generate_leads) {
      try {
        const leadResponse = await base44.functions.invoke('generateStormLeads', {
          stormId: stormId
        });
        leadsGenerated = leadResponse.data.leadsGenerated || 0;
      } catch (error) {
        console.error('Failed to auto-generate leads:', error);
      }
    }

    return Response.json({
      success: true,
      stormTitle: storm.title,
      affectedServiceAreas: affectedServiceAreas,
      emailsSent: emailsSent.length,
      smsSent: smsSent.length,
      leadsGenerated: leadsGenerated,
      details: {
        emails: emailsSent,
        sms: smsSent
      }
    });

  } catch (error) {
    console.error('Storm alert error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});