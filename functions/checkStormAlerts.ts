import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    console.log('🌪️ [StormAlertCron] Checking for new storms matching alert settings...');

    const allSettings = await base44.asServiceRole.entities.StormAlertSettings.list('-created_date', 100);
    
    if (!allSettings || allSettings.length === 0) {
      console.log('📋 No storm alert settings configured. Skipping.');
      return Response.json({ success: true, message: 'No alert settings configured', processed: 0 });
    }

    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - 6);

    const recentStorms = await base44.asServiceRole.entities.StormEvent.list('-start_time', 500);
    const newStorms = recentStorms.filter(s => {
      if (!s.start_time) return false;
      const stormDate = new Date(s.start_time);
      return stormDate >= cutoffTime;
    });

    console.log(`📊 Found ${newStorms.length} storms in last 6 hours`);

    if (newStorms.length === 0) {
      return Response.json({ success: true, message: 'No recent storms to process', processed: 0 });
    }

    const severityLevels = { all: 0, minor: 1, moderate: 2, severe: 3, extreme: 4 };
    let totalAlerts = 0;
    let totalLeadsGenerated = 0;

    for (const settings of allSettings) {
      const companyId = settings.company_id;
      if (!companyId) continue;

      const threshold = severityLevels[settings.alert_severity_threshold] || 2;
      const monitoredTypes = settings.storm_types_to_monitor || ['hail', 'tornado', 'high_wind'];
      const serviceAreas = settings.service_areas || [];
      const serviceCenterLocation = (settings.service_center_location || '').toLowerCase();

      for (const storm of newStorms) {
        const stormSeverity = severityLevels[storm.severity] || 2;
        if (stormSeverity < threshold) continue;

        if (!monitoredTypes.includes(storm.event_type)) continue;

        let matchesArea = false;
        const stormAreas = storm.affected_areas || [];
        
        for (const stormArea of stormAreas) {
          const areaLower = stormArea.toLowerCase();
          
          if (serviceCenterLocation) {
            const centerParts = serviceCenterLocation.split(',').map(p => p.trim());
            if (centerParts.some(part => areaLower.includes(part))) {
              matchesArea = true;
              break;
            }
          }
          
          for (const sa of serviceAreas) {
            if (areaLower.includes(sa.toLowerCase()) || sa.toLowerCase().includes(areaLower)) {
              matchesArea = true;
              break;
            }
          }
          if (matchesArea) break;
        }

        if (!matchesArea) continue;

        console.log(`⚠️ Storm "${storm.title}" matches settings for company ${companyId}`);
        totalAlerts++;

        if (settings.auto_generate_leads && (!storm.leads_generated || storm.leads_generated === 0)) {
          try {
            console.log(`🤖 Auto-generating leads for storm: ${storm.title}`);
            
            const affectedAreas = storm.affected_areas || [];
            const prompt = `Generate 10 realistic roofing leads in these storm-affected areas: ${affectedAreas.join(', ')}\n\nStorm: ${storm.event_type}, Severity: ${storm.severity}\n\nFor each lead provide:\n- Property owner name\n- Full address in affected areas\n- Phone (555-XXX-XXXX format)\n- Email\n- Damage level (minor/moderate/severe)\n- Brief damage notes`;

            const aiResponse = await base44.integrations.Core.InvokeLLM({
              prompt,
              add_context_from_internet: false,
              response_json_schema: {
                type: "object",
                properties: {
                  leads: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        address: { type: "string" },
                        phone: { type: "string" },
                        email: { type: "string" },
                        damage_level: { type: "string" },
                        notes: { type: "string" }
                      }
                    }
                  }
                }
              }
            });

            const generatedLeads = aiResponse.leads || [];
            let leadsCreated = 0;

            for (const property of generatedLeads) {
              try {
                const estimatedJobValue = property.damage_level === 'severe' ? 15000 :
                                          property.damage_level === 'moderate' ? 8000 : 3000;

                await base44.asServiceRole.entities.Lead.create({
                  company_id: companyId,
                  name: property.name,
                  company: property.address,
                  email: property.email || "",
                  phone: property.phone || "",
                  status: "new",
                  source: "storm_tracker",
                  lead_source: `Storm Tracker - ${storm.title}`,
                  value: estimatedJobValue,
                  is_active: true,
                  notes: [
                    `Property affected by: ${storm.title}`,
                    `Storm Type: ${storm.event_type}`,
                    `Severity: ${storm.severity}`,
                    storm.hail_size_inches ? `Hail: ${storm.hail_size_inches}"` : "",
                    storm.wind_speed_mph ? `Wind: ${storm.wind_speed_mph} mph` : "",
                    `Property: ${property.address}`,
                    `Est. Value: $${estimatedJobValue.toLocaleString()}`,
                    `Damage: ${property.damage_level}`,
                    property.notes || ""
                  ].filter(Boolean).join("\n")
                });
                leadsCreated++;
              } catch (e) {
                console.error(`❌ Failed to create lead:`, e.message);
              }
            }

            totalLeadsGenerated += leadsCreated;
            
            await base44.asServiceRole.entities.StormEvent.update(storm.id, {
              leads_generated: (storm.leads_generated || 0) + leadsCreated
            });
            
            console.log(`✅ Generated ${leadsCreated} leads for storm: ${storm.title}`);
          } catch (err) {
            console.error(`❌ Failed to generate leads for storm ${storm.title}:`, err.message);
          }
        }

        const recipients = settings.alert_recipients || [];
        if (recipients.length > 0 && (settings.enable_email_alerts || settings.enable_sms_alerts)) {
          for (const recipient of recipients) {
            try {
              if (settings.enable_email_alerts && recipient.notify_email && recipient.email) {
                const alertTitle = `Storm Alert: ${storm.title}`;
                const alertMessage = `A ${storm.severity} ${storm.event_type} has been detected in your service area!\n\nAffected: ${(storm.affected_areas || []).join(', ')}\n${storm.hail_size_inches ? `Hail: ${storm.hail_size_inches}"\n` : ''}${storm.wind_speed_mph ? `Wind: ${storm.wind_speed_mph} mph\n` : ''}`;
                await base44.functions.invoke('sendUnifiedEmail', {
                  to: recipient.email,
                  subject: alertTitle,
                  message: alertMessage,
                  companyId: companyId,
                  contactName: recipient.name,
                  skipNotification: true,
                  skipLogging: false
                });
                console.log(`📧 Email sent to ${recipient.email}`);
              }
            } catch (err) {
              console.error(`❌ Failed to send alert to ${recipient.email}:`, err.message);
            }
          }
        }
      }
    }

    console.log(`✅ [StormAlertCron] Complete: ${totalAlerts} alerts, ${totalLeadsGenerated} leads generated`);

    return Response.json({
      success: true,
      stormsChecked: newStorms.length,
      alertsTriggered: totalAlerts,
      leadsGenerated: totalLeadsGenerated
    });

  } catch (error) {
    console.error('❌ [StormAlertCron] Error:', error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
});
